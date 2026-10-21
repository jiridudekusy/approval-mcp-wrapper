import type { FastifyInstance } from 'fastify';
import type { ConfigStateStore } from '@approval-mcp/state-store';
import type { ApprovalOrchestrator, TokenService } from '@approval-mcp/gateway';
import type { ClientTokenId, ClientTokenRecord, JsonValue } from '@approval-mcp/contracts';
import type { StateOperation } from '@approval-mcp/state-store';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';

export async function registerTokenRoutes(
  app: FastifyInstance,
  options: {
    sessions: SessionService;
    state: ConfigStateStore;
    tokens: TokenService;
    approvals?: ApprovalOrchestrator;
    onVisibilityChanged?(): void;
  },
): Promise<void> {
  let writeQueue: Promise<void> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  app.get('/api/admin/tokens', async (request, reply) => {
    if (
      (await authorizeAdmin(request, reply, options.sessions, false)) ===
      undefined
    ) {
      return;
    }
    return options.state.read((state) =>
      Object.values(state.clientTokens).filter((value) =>
        (value as unknown as ClientTokenRecord).deletedAt === undefined,
      ).map((value) => {
        const record = value as unknown as ClientTokenRecord;
        return {
          id: record.id,
          label: record.label,
          canManageApprovalMcp: record.canManageApprovalMcp === true,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          version: record.version,
          ...(record.authKind === undefined ? {} : { authKind: record.authKind }),
          ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
          ...(record.revokedAt === undefined
            ? {}
            : { revokedAt: record.revokedAt }),
          ...(record.lastUsedAt === undefined
            ? {}
            : { lastUsedAt: record.lastUsedAt }),
          profileIds: Object.values(state.tokenProfileAssignments)
            .filter(
              (assignment) =>
                (assignment as { clientTokenId?: unknown }).clientTokenId ===
                record.id,
            )
            .map(
              (assignment) =>
                (assignment as { profileId: string }).profileId,
            ),
        };
      }),
    );
  });

  app.post('/api/admin/tokens', async (request, reply) => {
    if (
      (await authorizeAdmin(request, reply, options.sessions, true)) === undefined
    ) {
      return;
    }
    const body = request.body as { label?: unknown; canManageApprovalMcp?: unknown };
    if (typeof body.label !== 'string' || (body.canManageApprovalMcp !== undefined && typeof body.canManageApprovalMcp !== 'boolean')) {
      reply.code(400);
      return { error: { code: 'input.invalid', message: 'Invalid token label', requestId: request.id } };
    }
    const created = await options.tokens.create(body.label, body.canManageApprovalMcp === true);
    reply.code(201);
    return {
      record: {
        id: created.record.id,
        label: created.record.label,
        canManageApprovalMcp: created.record.canManageApprovalMcp === true,
        createdAt: created.record.createdAt,
        version: created.record.version,
      },
      plaintext: created.plaintext,
    };
  });

  app.delete('/api/admin/tokens/:id', async (request, reply) => {
    if (
      (await authorizeAdmin(request, reply, options.sessions, true)) === undefined
    ) {
      return;
    }
    return serialized(async () => {
      const { id } = request.params as { id: string };
      const version = (request.body as { version?: unknown } | undefined)?.version;
      const snapshot = options.state.read((state) => ({
        token: state.clientTokens[id] as unknown as ClientTokenRecord | undefined,
        assignments: Object.entries(state.tokenProfileAssignments),
        policies: Object.entries(state.policies),
        grants: Object.entries(state.grants),
        toolAccess: Object.entries(state.toolAccess),
      }));
      const token = snapshot.token;
      if (token === undefined || token.deletedAt !== undefined) {
        return reply.code(404).send({ error: { code: 'token.not_found', message: 'Agent not found', requestId: request.id } });
      }
      if (version !== undefined && version !== token.version) {
        return reply.code(409).send({ error: { code: 'state.version_conflict', message: 'Agent changed', requestId: request.id } });
      }
      const now = new Date().toISOString();
      const operations: StateOperation[] = [{
        type: 'record.upserted', collection: 'clientTokens', id,
        value: {
          ...token,
          hash: '', salt: '', canManageApprovalMcp: false,
          revokedAt: token.revokedAt ?? now, deletedAt: now,
          updatedAt: now, version: token.version + 1,
        } as unknown as JsonValue,
      }];
      for (const [collection, entries] of [
        ['tokenProfileAssignments', snapshot.assignments],
        ['policies', snapshot.policies],
        ['grants', snapshot.grants],
        ['toolAccess', snapshot.toolAccess],
      ] as const) {
        for (const [recordId, record] of entries) {
          if ((record as { clientTokenId?: unknown }).clientTokenId === id) {
            operations.push({ type: 'record.deleted', collection, id: recordId });
          }
        }
      }
      await options.state.mutate({ type: 'records.batch', operations });
      await options.approvals?.interruptForToken(id as ClientTokenId);
      options.onVisibilityChanged?.();
      return reply.code(204).send();
    });
  });

  app.put('/api/admin/tokens/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    return serialized(async () => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        version?: unknown;
        label?: unknown;
        canManageApprovalMcp?: unknown;
      };
      const current = options.state.read((state) => state.clientTokens[id] as unknown as ClientTokenRecord | undefined);
      if (current === undefined || current.deletedAt !== undefined) {
        return reply.code(404).send({ error: { code: 'token.not_found', message: 'Agent not found', requestId: request.id } });
      }
      if (body.version !== current.version) {
        return reply.code(409).send({ error: { code: 'state.version_conflict', message: 'Agent changed', requestId: request.id } });
      }
      if (current.authKind === 'oauth' && body.canManageApprovalMcp === true) {
        return reply.code(400).send({ error: { code: 'token.oauth_manager_forbidden', message: 'OAuth clients cannot manage Approval MCP', requestId: request.id } });
      }
      if ((body.label === undefined && body.canManageApprovalMcp === undefined) ||
        (body.label !== undefined && (typeof body.label !== 'string' || body.label.trim().length === 0 || body.label.trim().length > 120)) ||
        (body.canManageApprovalMcp !== undefined && typeof body.canManageApprovalMcp !== 'boolean')) {
        return reply.code(400).send({ error: { code: 'input.invalid', message: 'Invalid agent update', requestId: request.id } });
      }
      const updated = await options.tokens.update(id as ClientTokenId, {
        ...(typeof body.label === 'string' ? { label: body.label } : {}),
        ...(typeof body.canManageApprovalMcp === 'boolean' ? { canManageApprovalMcp: body.canManageApprovalMcp } : {}),
      });
      options.onVisibilityChanged?.();
      return { id: updated.id, label: updated.label, canManageApprovalMcp: updated.canManageApprovalMcp === true, version: updated.version };
    });
  });

  app.post('/api/admin/tokens/:id/rotate', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    return serialized(async () => {
      const { id } = request.params as { id: string };
      const version = (request.body as { version?: unknown } | undefined)?.version;
      const current = options.state.read((state) => state.clientTokens[id] as unknown as ClientTokenRecord | undefined);
      if (current === undefined || current.deletedAt !== undefined || current.revokedAt !== undefined) {
        return reply.code(404).send({ error: { code: 'token.not_found', message: 'Active agent not found', requestId: request.id } });
      }
      if (version !== current.version) {
        return reply.code(409).send({ error: { code: 'state.version_conflict', message: 'Agent changed', requestId: request.id } });
      }
      if (current.authKind === 'oauth') {
        return reply.code(400).send({ error: { code: 'token.oauth_rotation_forbidden', message: 'OAuth clients cannot rotate manual tokens', requestId: request.id } });
      }
      const rotated = await options.tokens.rotate(id as ClientTokenId);
      return { plaintext: rotated.plaintext, version: rotated.record.version };
    });
  });
}
