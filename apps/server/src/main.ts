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
import { registerAdminRoutes } from './admin/index.js';
import fastifyStatic from '@fastify/static';
import type {
  ClientTokenId,
  Grant,
  Policy,
  Upstream,
} from '@approval-mcp/contracts';
import { evaluatePolicy } from '@approval-mcp/policy';
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
const policies = () =>
  stateStore.read((state) =>
    Object.values(state.policies).map((value) => value as unknown as Policy),
  );
const grants = () =>
  stateStore.read((state) =>
    Object.values(state.grants).map((value) => value as unknown as Grant),
  );
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
      policies: policies(),
      grants: [],
      now: new Date().toISOString(),
    }).reasonCode === 'policy.explicit_deny',
);
await approvals.interruptAll('server.restarted');
const tokens = new TokenService(new StateStoreTokenRepository(stateStore));
const coordinator = new PolicyCallCoordinator({
  policies,
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
  const visible = new Set(
    policies()
      .filter(
        (policy) => policy.enabled && policy.clientTokenId === tokenId,
      )
      .flatMap((policy) => {
        const upstream = configuredUpstreams().find(
          (candidate) => candidate.id === policy.upstreamId,
        );
        return upstream === undefined
          ? []
          : [`${upstream.alias}__${policy.toolName}`];
      }),
  );
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
