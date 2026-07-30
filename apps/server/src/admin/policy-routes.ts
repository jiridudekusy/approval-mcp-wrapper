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
    return reply.code(410).send({
      error: {
        code: 'policy.profiles_required',
        message: 'Direct policies have been replaced by profile rules',
        requestId: request.id,
      },
    });
  });
}
