import type {
  ClientTokenRecord,
  Grant,
  JsonValue,
  Upstream,
} from '@approval-mcp/contracts';
import type { ConfigStateStore } from '@approval-mcp/state-store';
import type { FastifyInstance } from 'fastify';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';

export async function registerGrantRoutes(
  app: FastifyInstance,
  options: { sessions: SessionService; state: ConfigStateStore },
): Promise<void> {
  app.get('/api/admin/grants', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    const now = new Date().toISOString();
    return options.state.read((state) =>
      Object.values(state.grants)
        .map((value) => value as unknown as Grant)
        .filter(
          (grant) =>
            grant.revokedAt === undefined &&
            grant.callId === undefined &&
            (grant.expiresAt === undefined || grant.expiresAt > now),
        )
        .map((grant) => {
          const token = state.clientTokens[grant.clientTokenId] as
            | unknown
            | undefined;
          const upstream = state.upstreams[grant.upstreamId] as
            | unknown
            | undefined;
          return {
            id: grant.id,
            clientTokenId: grant.clientTokenId,
            tokenLabel:
              (token as ClientTokenRecord | undefined)?.label,
            upstreamId: grant.upstreamId,
            upstreamAlias:
              (upstream as Upstream | undefined)?.alias,
            toolName: grant.toolName,
            predicates: grant.predicates,
            ...(grant.presentation === undefined
              ? {}
              : { presentation: grant.presentation }),
            scope: grant.expiresAt === undefined ? 'forever' : 'until',
            createdAt: grant.createdAt,
            ...(grant.expiresAt === undefined
              ? {}
              : { expiresAt: grant.expiresAt }),
            version: grant.version,
          };
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
  });

  app.delete('/api/admin/grants/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version?: unknown };
    const grant = options.state.read(
      (state) => state.grants[id] as unknown as Grant | undefined,
    );
    if (grant === undefined) {
      reply.code(404);
      return {
        error: {
          code: 'grant.not_found',
          message: 'Grant not found',
          requestId: request.id,
        },
      };
    }
    if (body.version !== grant.version) {
      reply.code(409);
      return {
        error: {
          code: 'state.version_conflict',
          message: 'The record has changed',
          requestId: request.id,
        },
      };
    }
    const now = new Date().toISOString();
    await options.state.mutate({
      type: 'record.upserted',
      collection: 'grants',
      id,
      value: {
        ...grant,
        revokedAt: now,
        updatedAt: now,
        version: grant.version + 1,
      } as unknown as JsonValue,
    });
    return reply.code(204).send();
  });
}
