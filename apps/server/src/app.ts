import Fastify, { type FastifyInstance } from 'fastify';

import {
  registerAuthRoutes,
  type AuthRouteOptions,
} from './auth-routes.js';

export async function buildServerApp(options: {
  auth: AuthRouteOptions;
  readiness?: () => Promise<unknown>;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
  });
  await registerAuthRoutes(app, options.auth);
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'Request failed');
    reply.code(500).send({
      error: {
        code: 'server.internal_error',
        message: 'The request could not be completed',
        requestId: request.id,
      },
    });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const result = await options.readiness?.() ?? { ready: true };
    if (
      typeof result === 'object' &&
      result !== null &&
      'ready' in result &&
      result.ready === false
    ) {
      reply.code(503);
    }
    return result;
  });
  return app;
}
