import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AdminSession, SessionService } from '../session-store.js';

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  for (const part of request.headers.cookie?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

export async function authorizeAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: SessionService,
  mutation: boolean,
): Promise<AdminSession | undefined> {
  const token = cookieValue(request, 'amcp_admin');
  const csrf = request.headers['x-csrf-token'];
  const session =
    token === undefined
      ? undefined
      : await sessions.authenticate(
          token,
          mutation && typeof csrf === 'string' ? csrf : undefined,
        );
  if (session === undefined) {
    const code =
      token !== undefined && mutation ? 'auth.csrf_invalid' : 'auth.unauthorized';
    reply.code(code === 'auth.unauthorized' ? 401 : 403).send({
      error: {
        code,
        message:
          code === 'auth.unauthorized'
            ? 'Authentication is required'
            : 'CSRF validation failed',
        requestId: request.id,
      },
    });
    return undefined;
  }
  if (mutation && typeof csrf !== 'string') {
    reply.code(403).send({
      error: {
        code: 'auth.csrf_invalid',
        message: 'CSRF validation failed',
        requestId: request.id,
      },
    });
    return undefined;
  }
  return session;
}
