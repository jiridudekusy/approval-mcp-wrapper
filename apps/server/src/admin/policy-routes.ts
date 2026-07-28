import { randomUUID } from 'node:crypto';

import type { JsonValue, Policy, PolicyId } from '@approval-mcp/contracts';
import type { ConfigStateStore } from '@approval-mcp/state-store';
import type { FastifyInstance } from 'fastify';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';

export async function registerPolicyRoutes(
  app: FastifyInstance,
  options: { sessions: SessionService; state: ConfigStateStore },
): Promise<void> {
  app.get('/api/admin/policies', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    return options.state.read((state) => Object.values(state.policies));
  });

  app.post('/api/admin/policies', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    const body = request.body as Partial<Policy>;
    if (
      typeof body.clientTokenId !== 'string' ||
      typeof body.upstreamId !== 'string' ||
      typeof body.toolName !== 'string' ||
      !['allow', 'deny', 'require_approval'].includes(body.outcome ?? '')
    ) {
      reply.code(400);
      return { error: { code: 'input.invalid', message: 'Invalid policy', requestId: request.id } };
    }
    const now = new Date().toISOString();
    const policy: Policy = {
      id: randomUUID() as PolicyId,
      clientTokenId: body.clientTokenId,
      upstreamId: body.upstreamId,
      toolName: body.toolName,
      outcome: body.outcome as Policy['outcome'],
      predicates: body.predicates ?? [],
      enabled: body.enabled ?? true,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await options.state.mutate({
      type: 'record.upserted',
      collection: 'policies',
      id: policy.id,
      value: policy as unknown as JsonValue,
    });
    reply.code(201);
    return policy;
  });
}
