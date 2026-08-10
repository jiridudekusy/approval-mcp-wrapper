import { randomUUID } from 'node:crypto';

import type {
  JsonValue,
  Upstream,
  UpstreamId,
} from '@approval-mcp/contracts';
import type { CredentialVault, UpstreamCredentials } from '@approval-mcp/upstream';
import type { ToolCatalog } from '@approval-mcp/upstream';
import type { ConfigStateStore } from '@approval-mcp/state-store';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';

function publicUpstream(record: Upstream) {
  return {
    id: record.id,
    alias: record.alias,
    url: record.url,
    allowPrivateNetwork: record.allowPrivateNetwork,
    credentialsConfigured: record.credentials !== undefined,
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
    ...(record.pluginId === undefined ? {} : { pluginId: record.pluginId }),
    ...(record.pluginVersion === undefined
      ? {}
      : { pluginVersion: record.pluginVersion }),
  };
}

function conflict(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(409).send({
    error: {
      code: 'state.version_conflict',
      message: 'The record has changed',
      requestId: request.id,
    },
  });
}

export async function registerUpstreamRoutes(
  app: FastifyInstance,
  options: {
    sessions: SessionService;
    state: ConfigStateStore;
    credentialVault?: CredentialVault;
    onUpstreamsChanged?(): Promise<void>;
    discoverTools?(upstreamId: UpstreamId): Promise<ToolCatalog>;
    plugins?: readonly Readonly<{ id: string; version: string }>[];
  },
): Promise<void> {
  app.get('/api/admin/upstreams', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    return options.state.read((state) =>
      Object.values(state.upstreams).map((value) =>
        publicUpstream(value as unknown as Upstream),
      ),
    );
  });

  app.get('/api/admin/upstreams/:id/tools', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    const { id } = request.params as { id: string };
    const upstream = options.state.read((state) => state.upstreams[id]);
    if (upstream === undefined) {
      reply.code(404);
      return {
        error: {
          code: 'upstream.not_found',
          message: 'Upstream not found',
          requestId: request.id,
        },
      };
    }
    if (options.discoverTools === undefined) {
      reply.code(503);
      return {
        error: {
          code: 'upstream.discovery_unavailable',
          message: 'Tool discovery is unavailable',
          requestId: request.id,
        },
      };
    }
    try {
      const catalog = await options.discoverTools(id as UpstreamId);
      return {
        ...catalog,
        tools: [...catalog.tools].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      };
    } catch {
      reply.code(502);
      return {
        error: {
          code: 'upstream.discovery_failed',
          message: 'The upstream tool catalog could not be loaded',
          requestId: request.id,
        },
      };
    }
  });

  app.get(
    '/api/admin/upstreams/:id/deletion-impact',
    async (request, reply) => {
      if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
      const { id } = request.params as { id: string };
      const impact = options.state.read((state) => {
        if (state.upstreams[id] === undefined) return undefined;
        return {
          policies: Object.values(state.policies).filter(
            (record) =>
              (record as { upstreamId?: unknown }).upstreamId === id,
          ).length,
          profileRules: Object.values(state.profileRules).filter(
            (record) =>
              (record as { upstreamId?: unknown }).upstreamId === id,
          ).length,
          grants: Object.values(state.grants).filter(
            (record) =>
              (record as { upstreamId?: unknown }).upstreamId === id,
          ).length,
        };
      });
      if (impact === undefined) {
        reply.code(404);
        return {
          error: {
            code: 'upstream.not_found',
            message: 'Upstream not found',
            requestId: request.id,
          },
        };
      }
      return impact;
    },
  );

  app.post('/api/admin/upstreams', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    const body = request.body as {
      alias?: unknown;
      url?: unknown;
      allowPrivateNetwork?: unknown;
      credentials?: UpstreamCredentials;
      pluginId?: unknown;
      pluginVersion?: unknown;
    };
    if (
      typeof body.alias !== 'string' ||
      typeof body.url !== 'string' ||
      typeof body.allowPrivateNetwork !== 'boolean'
    ) {
      reply.code(400);
      return { error: { code: 'input.invalid', message: 'Invalid upstream', requestId: request.id } };
    }
    if (
      (body.pluginId !== undefined || body.pluginVersion !== undefined) &&
      !options.plugins?.some(
        (plugin) =>
          plugin.id === body.pluginId && plugin.version === body.pluginVersion,
      )
    ) {
      reply.code(400);
      return {
        error: {
          code: 'plugin.invalid_pin',
          message: 'Invalid plugin pin',
          requestId: request.id,
        },
      };
    }
    const id = randomUUID() as UpstreamId;
    const now = new Date().toISOString();
    const record: Upstream = {
      id,
      alias: body.alias,
      url: new URL(body.url).href,
      allowPrivateNetwork: body.allowPrivateNetwork,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...(typeof body.pluginId === 'string' ? { pluginId: body.pluginId } : {}),
      ...(typeof body.pluginVersion === 'string'
        ? { pluginVersion: body.pluginVersion }
        : {}),
      ...(body.credentials === undefined
        ? {}
        : {
            credentials: options.credentialVault?.encrypt(id, body.credentials) ??
              (() => { throw new Error('Credential vault is unavailable'); })(),
          }),
    };
    await options.state.mutate({
      type: 'record.upserted',
      collection: 'upstreams',
      id,
      value: record as unknown as JsonValue,
    });
    await options.onUpstreamsChanged?.();
    reply.code(201);
    return publicUpstream(record);
  });

  app.put('/api/admin/upstreams/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    const { id } = request.params as { id: string };
    const body = request.body as {
      version?: unknown;
      alias?: unknown;
      url?: unknown;
      allowPrivateNetwork?: unknown;
      credentials?: UpstreamCredentials | null;
      pluginId?: unknown;
      pluginVersion?: unknown;
    };
    const current = options.state.read((state) => state.upstreams[id]);
    if (current === undefined) {
      reply.code(404);
      return { error: { code: 'upstream.not_found', message: 'Upstream not found', requestId: request.id } };
    }
    const record = current as unknown as Upstream;
    if (body.version !== record.version) return conflict(request, reply);
    const pluginChanged =
      body.pluginId !== undefined || body.pluginVersion !== undefined;
    const removesPlugin =
      body.pluginId === null && body.pluginVersion === null;
    if (
      pluginChanged &&
      !removesPlugin &&
      !options.plugins?.some(
        (plugin) =>
          plugin.id === body.pluginId && plugin.version === body.pluginVersion,
      )
    ) {
      reply.code(400);
      return {
        error: {
          code: 'plugin.invalid_pin',
          message: 'Invalid plugin pin',
          requestId: request.id,
        },
      };
    }
    let updated: Upstream = {
      ...record,
      ...(typeof body.alias === 'string' ? { alias: body.alias } : {}),
      ...(typeof body.url === 'string' ? { url: new URL(body.url).href } : {}),
      ...(typeof body.allowPrivateNetwork === 'boolean'
        ? { allowPrivateNetwork: body.allowPrivateNetwork }
        : {}),
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    };
    if (removesPlugin) {
      const {
        pluginId: _removedPluginId,
        pluginVersion: _removedPluginVersion,
        ...withoutPlugin
      } = updated;
      updated = withoutPlugin;
    } else if (
      typeof body.pluginId === 'string' &&
      typeof body.pluginVersion === 'string'
    ) {
      updated = {
        ...updated,
        pluginId: body.pluginId,
        pluginVersion: body.pluginVersion,
      };
    }
    if (body.credentials === null) {
      const { credentials: _removed, ...withoutCredentials } = updated;
      updated = withoutCredentials;
    } else if (body.credentials !== undefined) {
      updated = {
        ...updated,
        credentials:
          options.credentialVault?.encrypt(record.id, body.credentials) ??
          (() => {
            throw new Error('Credential vault is unavailable');
          })(),
      };
    }
    await options.state.mutate({
      type: 'record.upserted',
      collection: 'upstreams',
      id,
      value: updated as unknown as JsonValue,
    });
    await options.onUpstreamsChanged?.();
    return publicUpstream(updated);
  });

  app.delete('/api/admin/upstreams/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version?: unknown };
    const deletion = options.state.read((state) => {
      const current = state.upstreams[id];
      if (current === undefined) return undefined;
      const record = current as unknown as Upstream;
      const policyIds = Object.entries(state.policies)
        .filter(
          ([, value]) =>
            (value as { upstreamId?: unknown }).upstreamId === id,
        )
        .map(([policyId]) => policyId);
      const grantIds = Object.entries(state.grants)
        .filter(
          ([, value]) =>
            (value as { upstreamId?: unknown }).upstreamId === id,
        )
        .map(([grantId]) => grantId);
      const profileRuleIds = Object.entries(state.profileRules)
        .filter(
          ([, value]) =>
            (value as { upstreamId?: unknown }).upstreamId === id,
        )
        .map(([profileRuleId]) => profileRuleId);
      return { record, policyIds, grantIds, profileRuleIds };
    });
    if (deletion === undefined) {
      reply.code(404);
      return {
        error: {
          code: 'upstream.not_found',
          message: 'Upstream not found',
          requestId: request.id,
        },
      };
    }
    if (body.version !== deletion.record.version) {
      return conflict(request, reply);
    }
    await options.state.mutate({
      type: 'records.batch',
      operations: [
        ...deletion.grantIds.map((grantId) => ({
          type: 'record.deleted' as const,
          collection: 'grants' as const,
          id: grantId,
        })),
        ...deletion.policyIds.map((policyId) => ({
          type: 'record.deleted' as const,
          collection: 'policies' as const,
          id: policyId,
        })),
        ...deletion.profileRuleIds.map((profileRuleId) => ({
          type: 'record.deleted' as const,
          collection: 'profileRules' as const,
          id: profileRuleId,
        })),
        {
          type: 'record.deleted',
          collection: 'upstreams',
          id,
        },
      ],
    });
    await options.onUpstreamsChanged?.();
    return reply.code(204).send();
  });
}
