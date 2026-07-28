import Fastify, { type FastifyInstance } from 'fastify';

import {
  registerAuthRoutes,
  type AuthRouteOptions,
} from './auth-routes.js';

export async function buildServerApp(options: {
  auth: AuthRouteOptions;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
  });
  await registerAuthRoutes(app, options.auth);
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
