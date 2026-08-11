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
  evaluateToolInspection,
  PolicyCallCoordinator,
  StateStoreApprovalRepository,
  StateStoreTokenRepository,
  TokenScopedGateway,
  TokenService,
  type ToolInspection,
  withPolicyDescription,
} from '@approval-mcp/gateway';
import {
  CredentialVault,
  UpstreamRegistry,
} from '@approval-mcp/upstream';
import {
  MinutesApprovalPlugin,
} from '@approval-mcp/minutes-plugin';
import {
  createGenericDescription,
  PluginRegistry,
} from '@approval-mcp/plugin-sdk';
import { join } from 'node:path';
import {
  ApprovalEventBroker,
  HistoryEventBroker,
  registerAdminRoutes,
} from './admin/index.js';
import fastifyStatic from '@fastify/static';
import type {
  ClientTokenId,
  Grant,
  JsonValue,
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
import { PushNotificationService } from './push-notification-service.js';

const config = loadConfig();
const stateStore = await createConfigStateStore(config.dataDir);
const historyBroker = new HistoryEventBroker();
const journal = await createCallJournal(
  join(config.dataDir, 'calls'),
  (event) => historyBroker.publish({
    callId: event.callId,
    timestamp: event.timestamp,
    type: event.type,
  }),
);
const sessions = new SessionService(new StateSessionRepository(stateStore));
const credentialVault = new CredentialVault(config.masterKey);
const pushNotifications = await PushNotificationService.create({
  state: stateStore,
  masterKey: config.masterKey,
  vapidSubject: config.vapidSubject,
});
const configuredUpstreams = () =>
  stateStore.read((state) =>
    Object.values(state.upstreams).map((value) => value as unknown as Upstream),
  );
const upstreams = new UpstreamRegistry({
  upstreams: configuredUpstreams(),
  credentialVault,
});
const pluginRegistry = new PluginRegistry([
  new MinutesApprovalPlugin({
    async readJson(upstreamId, uri) {
      const result = (await upstreams.readResource({
        upstreamId: upstreamId as Upstream['id'],
        uri,
        timeoutMs: 3_000,
      })) as {
        contents?: readonly Readonly<{ text?: unknown }>[];
      };
      const text = result.contents?.find(
        (content) => typeof content.text === 'string',
      )?.text;
      if (typeof text !== 'string') return undefined;
      return JSON.parse(text) as JsonValue;
    },
  }),
]);
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
  (approval) => {
    approvalBroker.publish({
      approvalId: approval.id,
      status: approval.status,
    });
    void pushNotifications.notifyPending(approval).catch(() => undefined);
  },
);
await approvals.interruptAll('server.restarted');
const tokens = new TokenService(new StateStoreTokenRepository(stateStore));
const timeoutsFor = (clientTokenId: ClientTokenId) => ({
  approvalTimeoutSeconds: resolveApprovalTimeoutSeconds({
    clientTokenId,
    profiles: profiles(),
    assignments: profileAssignments(),
  }),
  toolCallTimeoutSeconds: resolveToolCallTimeoutSeconds({
    clientTokenId,
    profiles: profiles(),
    assignments: profileAssignments(),
  }),
});
const coordinator = new PolicyCallCoordinator({
  policies: (input) =>
    policiesFor(input.clientTokenId, input.upstreamId, input.toolName),
  approvalTimeoutMs: (input) =>
    timeoutsFor(input.clientTokenId).approvalTimeoutSeconds * 1_000,
  toolCallTimeoutMs: (input) =>
    timeoutsFor(input.clientTokenId).toolCallTimeoutSeconds * 1_000,
  grants,
  describe: async (input) => {
    const upstream = configuredUpstreams().find(
      (candidate) => candidate.id === input.upstreamId,
    );
    if (upstream === undefined) {
      throw new Error(`Unknown upstream: ${input.upstreamId}`);
    }
    const toolDescription = upstreams
      .getCatalog(input.upstreamId)
      ?.tools.find((tool) => tool.name === input.toolName)?.description;
    const pluginInput = {
      upstreamId: input.upstreamId,
      upstreamAlias: upstream.alias,
      toolName: input.toolName,
      ...(toolDescription === undefined
        ? {}
        : { toolDescription }),
      arguments: input.arguments as JsonValue,
    };
    if (
      upstream.pluginId === undefined ||
      upstream.pluginVersion === undefined
    ) {
      return {
        description: createGenericDescription(pluginInput),
        normalizationVersion: 1,
      };
    }
    const pin = {
      id: upstream.pluginId,
      version: upstream.pluginVersion,
    };
    return {
      description: await pluginRegistry.describe(pin, pluginInput),
      normalizationVersion: pluginRegistry.normalizationVersion(pin),
      pluginId: pin.id,
      pluginVersion: pin.version,
    };
  },
  approvals,
  upstream: upstreams,
  journal,
});
const sourceToolsFor = async (refreshCatalogs: boolean) => {
  const sourceTools: CatalogSourceTool[] = [];
  for (const upstreamId of upstreams.upstreamIds()) {
    const configured = configuredUpstreams().find(
      (candidate) => candidate.id === upstreamId,
    );
    if (configured === undefined) continue;
    try {
      const catalog = refreshCatalogs
        ? await upstreams.refresh(upstreamId)
        : upstreams.getCatalog(upstreamId) ?? await upstreams.refresh(upstreamId);
      for (const tool of catalog.tools) {
        sourceTools.push({
          upstreamId,
          upstreamAlias: configured.alias,
          tool,
        });
      }
    } catch {
      const cached = upstreams.getCatalog(upstreamId);
      if (cached === undefined) continue;
      for (const tool of cached.tools) {
        sourceTools.push({
          upstreamId,
          upstreamAlias: configured.alias,
          tool,
        });
      }
    }
  }
  return sourceTools;
};
const catalogFor = async (
  tokenId: ClientTokenId,
  refreshCatalogs = true,
) => {
  const sourceTools = await sourceToolsFor(refreshCatalogs);
  const visible = new Set<string>();
  const approvalByTool = new Map<string, boolean>();
  const timeouts = timeoutsFor(tokenId);
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
      const publicName = `${source.upstreamAlias}__${source.tool.name}`;
      visible.add(publicName);
      approvalByTool.set(publicName, outcomes.includes('require_approval'));
    }
  }
  return buildTokenCatalog(
    tokenId,
    sourceTools.map((source) => {
      const approvalMayBeRequired = approvalByTool.get(
        `${source.upstreamAlias}__${source.tool.name}`,
      );
      return approvalMayBeRequired === undefined
        ? source
        : {
            ...source,
            tool: withPolicyDescription(source.tool, {
              approvalMayBeRequired,
              ...timeouts,
            }),
          };
    }),
    new Map([[tokenId, visible]]),
  );
};
const inspectTool = async (
  tokenId: ClientTokenId,
  toolName: string,
  argumentsValue: Record<string, unknown>,
): Promise<ToolInspection | undefined> => {
  const tool = (await catalogFor(tokenId, false)).find(
    (candidate) => candidate.name === toolName,
  );
  if (tool === undefined) return undefined;
  return evaluateToolInspection({
    publicToolName: toolName,
    clientTokenId: tokenId,
    upstreamId: tool.upstreamId,
    upstreamToolName: tool.upstreamToolName,
    argumentsValue,
    policies: policiesFor(tokenId, tool.upstreamId, tool.upstreamToolName),
    grants: grants(),
    ...timeoutsFor(tokenId),
  });
};
const mcpGateway = new TokenScopedGateway({
  coordinator,
  catalogFor,
  inspectTool,
});
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
  historyBroker,
  journal,
  plugins: pluginRegistry.list(),
  push: pushNotifications,
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
