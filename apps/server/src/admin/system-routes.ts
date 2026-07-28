import type { FastifyInstance } from 'fastify';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';

export async function registerSystemRoutes(
  app: FastifyInstance,
  options: { sessions: SessionService },
): Promise<void> {
  app.get('/api/admin/system', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    return {
      status: 'ok',
      runtime: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });
}
