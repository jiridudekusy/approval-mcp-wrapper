import { buildServerApp } from './app.js';
import {
  StatePasskeyRepository,
  StateRecoveryRepository,
  StateSessionRepository,
} from './auth-state-repositories.js';
import { loadConfig } from './config.js';
import { PasskeyService } from './passkey-service.js';
import { RecoveryService } from './recovery-service.js';
import { SessionService } from './session-store.js';
import { createConfigStateStore } from '@approval-mcp/state-store';
import { createCallJournal } from '@approval-mcp/call-journal';
import {
  ApprovalOrchestrator,
  buildTokenCatalog,
  type CatalogSourceTool,
  createMcpHttpHandler,
  PolicyCallCoordinator,
  StateStoreApprovalRepository,
  StateStoreTokenRepository,
  TokenScopedGateway,
  TokenService,
} from '@approval-mcp/gateway';
import {
  CredentialVault,
  UpstreamRegistry,
} from '@approval-mcp/upstream';
import { join } from 'node:path';
import {
  ApprovalEventBroker,
  registerAdminRoutes,
} from './admin/index.js';
import fastifyStatic from '@fastify/static';
import type {
  ClientTokenId,
  Grant,
  Policy,
  PolicyId,
  Profile,
  ProfileRule,
  TokenProfileAssignment,
  Upstream,
} from '@approval-mcp/contracts';
import {
  evaluatePolicy,
  resolveApprovalTimeoutSeconds,
  resolveProfileRules,
  resolveToolCallTimeoutSeconds,
} from '@approval-mcp/policy';
import { readiness } from './operations/health.js';
import { startRetentionJob } from './operations/retention-job.js';

const config = loadConfig();
const stateStore = await createConfigStateStore(config.dataDir);
const journal = await createCallJournal(join(config.dataDir, 'calls'));
const sessions = new SessionService(new StateSessionRepository(stateStore));
const credentialVault = new CredentialVault(config.masterKey);
const configuredUpstreams = () =>
  stateStore.read((state) =>
    Object.values(state.upstreams).map((value) => value as unknown as Upstream),
  );
const upstreams = new UpstreamRegistry({
  upstreams: configuredUpstreams(),
  credentialVault,
});
const directPolicies = () =>
  stateStore.read((state) =>
    Object.values(state.policies).map((value) => value as unknown as Policy),
  );
const profiles = () =>
  stateStore.read((state) =>
    Object.values(state.profiles).map((value) => value as unknown as Profile),
  );
const profileRules = () =>
  stateStore.read((state) =>
    Object.values(state.profileRules).map(
      (value) => value as unknown as ProfileRule,
    ),
  );
const profileAssignments = () =>
  stateStore.read((state) =>
    Object.values(state.tokenProfileAssignments).map(
      (value) => value as unknown as TokenProfileAssignment,
    ),
  );
const policiesFor = (
  clientTokenId: ClientTokenId,
  upstreamId: Upstream['id'],
  toolName: string,
): Policy[] => {
  const resolved = resolveProfileRules({
    clientTokenId,
    upstreamId,
    toolName,
    profiles: profiles(),
    rules: profileRules(),
    assignments: profileAssignments(),
  });
  return [
    ...directPolicies(),
    ...resolved.rules.map((rule) => ({
      ...rule,
      id: rule.id as unknown as PolicyId,
      clientTokenId,
      toolName,
    })),
  ];
};
const grants = () =>
  stateStore.read((state) =>
    Object.values(state.grants).map((value) => value as unknown as Grant),
  );
const approvalBroker = new ApprovalEventBroker();
const approvals = new ApprovalOrchestrator(
  new StateStoreApprovalRepository(stateStore),
  () => new Date(),
  (input) =>
    evaluatePolicy({
      visible: true,
      clientTokenId: input.clientTokenId,
      upstreamId: input.upstreamId,
      toolName: input.toolName,
      context: input.context,
      requestHash: input.requestHash,
      normalizationVersion: input.normalizationVersion,
      policies: policiesFor(input.clientTokenId, input.upstreamId, input.toolName),
      grants: [],
      now: new Date().toISOString(),
    }).reasonCode === 'policy.explicit_deny',
  (approval) =>
    approvalBroker.publish({
      approvalId: approval.id,
      status: approval.status,
    }),
);
await approvals.interruptAll('server.restarted');
const tokens = new TokenService(new StateStoreTokenRepository(stateStore));
const coordinator = new PolicyCallCoordinator({
  policies: (input) =>
    policiesFor(input.clientTokenId, input.upstreamId, input.toolName),
  approvalTimeoutMs: (input) =>
    resolveApprovalTimeoutSeconds({
      clientTokenId: input.clientTokenId,
      profiles: profiles(),
      assignments: profileAssignments(),
    }) * 1_000,
  toolCallTimeoutMs: (input) =>
    resolveToolCallTimeoutSeconds({
      clientTokenId: input.clientTokenId,
      profiles: profiles(),
      assignments: profileAssignments(),
    }) * 1_000,
  grants,
  approvals,
  upstream: upstreams,
  journal,
});
const catalogFor = async (tokenId: ClientTokenId) => {
  const sourceTools: CatalogSourceTool[] = [];
  for (const upstreamId of upstreams.upstreamIds()) {
    try {
      const catalog = await upstreams.refresh(upstreamId);
      const upstream = configuredUpstreams().find(
        (candidate) => candidate.id === upstreamId,
      );
      if (upstream === undefined) continue;
      for (const tool of catalog.tools) {
        sourceTools.push({
          upstreamId,
          upstreamAlias: upstream.alias,
          tool,
        });
      }
    } catch {
      const cached = upstreams.getCatalog(upstreamId);
      const upstream = configuredUpstreams().find(
        (candidate) => candidate.id === upstreamId,
      );
      if (cached === undefined || upstream === undefined) continue;
      for (const tool of cached.tools) {
        sourceTools.push({
          upstreamId,
          upstreamAlias: upstream.alias,
          tool,
        });
      }
    }
  }
  const visible = new Set<string>();
  for (const source of sourceTools) {
    const resolved = resolveProfileRules({
      clientTokenId: tokenId,
      upstreamId: source.upstreamId,
      toolName: source.tool.name,
      profiles: profiles(),
      rules: profileRules(),
      assignments: profileAssignments(),
    });
    const matchingDirect = directPolicies().filter(
      (policy) =>
        policy.enabled &&
        policy.clientTokenId === tokenId &&
        policy.upstreamId === source.upstreamId &&
        policy.toolName === source.tool.name,
    );
    const outcomes = [
      ...(resolved.outcome === 'unconfigured' ? [] : [resolved.outcome]),
      ...matchingDirect.map((policy) => policy.outcome),
    ];
    if (
      outcomes.length > 0 &&
      !outcomes.includes('deny')
    ) {
      visible.add(`${source.upstreamAlias}__${source.tool.name}`);
    }
  }
  return buildTokenCatalog(
    tokenId,
    sourceTools,
    new Map([[tokenId, visible]]),
  );
};
const mcpGateway = new TokenScopedGateway({ coordinator, catalogFor });
const mcpHandler = createMcpHttpHandler({
  allowedOrigins: [config.expectedOrigin],
  authenticate: async (plaintext) =>
    (await tokens.authenticate(plaintext))?.id,
  gateway: mcpGateway,
});
const app = await buildServerApp({
  readiness: () =>
    readiness(config.dataDir, {
      stateLoaded: true,
      masterKeyLoaded: true,
    }),
  auth: {
    passkeys: new PasskeyService({
      rpName: 'Approval MCP Wrapper',
      rpId: config.rpId,
      expectedOrigin: config.expectedOrigin,
      repository: new StatePasskeyRepository(stateStore),
    }),
    sessions,
    recovery: new RecoveryService(new StateRecoveryRepository(stateStore)),
    secureCookies: config.secureCookies,
  },
});
const retention = startRetentionJob({
  journal,
  retentionDays: Number(process.env['APPROVAL_MCP_RETENTION_DAYS'] ?? 90),
});
await registerAdminRoutes(app, {
  sessions,
  state: stateStore,
  tokens,
  credentialVault,
  approvals,
  broker: approvalBroker,
  journal,
  onUpstreamsChanged: async () =>
    upstreams.replaceUpstreams(configuredUpstreams()),
  discoverTools: (upstreamId) => upstreams.refresh(upstreamId),
});
app.route({
  method: ['GET', 'POST', 'DELETE'],
  url: '/mcp',
  handler: async (request, reply) => {
    reply.hijack();
    await mcpHandler(request.raw, reply.raw, request.body);
  },
});
await app.register(fastifyStatic, {
  root: join(process.cwd(), 'apps', 'web', 'dist'),
  wildcard: false,
});
app.setNotFoundHandler((request, reply) => {
  if (request.method === 'GET' && !request.url.startsWith('/api/')) {
    return reply.sendFile('index.html');
  }
  return reply.code(404).send({
    error: {
      code: 'route.not_found',
      message: 'Route not found',
      requestId: request.id,
    },
  });
});

app.addHook('onClose', async () => {
  retention.close();
  await upstreams.close();
  await stateStore.close();
});

await app.listen({
  host: process.env['HOST'] ?? '127.0.0.1',
  port: Number(process.env['PORT'] ?? 3000),
});
