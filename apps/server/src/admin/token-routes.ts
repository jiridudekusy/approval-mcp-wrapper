import type { FastifyInstance } from 'fastify';
import type { ConfigStateStore } from '@approval-mcp/state-store';
import type { TokenService } from '@approval-mcp/gateway';
import type { ClientTokenId, ClientTokenRecord } from '@approval-mcp/contracts';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';

export async function registerTokenRoutes(
  app: FastifyInstance,
  options: {
    sessions: SessionService;
    state: ConfigStateStore;
    tokens: TokenService;
  },
): Promise<void> {
  app.get('/api/admin/tokens', async (request, reply) => {
    if (
      (await authorizeAdmin(request, reply, options.sessions, false)) ===
      undefined
    ) {
      return;
    }
    return options.state.read((state) =>
      Object.values(state.clientTokens).map((value) => {
        const record = value as unknown as ClientTokenRecord;
        return {
          id: record.id,
          label: record.label,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          version: record.version,
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
    const body = request.body as { label?: unknown };
    if (typeof body.label !== 'string') {
      reply.code(400);
      return { error: { code: 'input.invalid', message: 'Invalid token label', requestId: request.id } };
    }
    const created = await options.tokens.create(body.label);
    reply.code(201);
    return {
      record: {
        id: created.record.id,
        label: created.record.label,
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
    const { id } = request.params as { id: string };
    await options.tokens.revoke(id as ClientTokenId);
    reply.code(204).send();
  });
}
