import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { RecoveryService } from './recovery-service.js';
import type { SessionService } from './session-store.js';

interface AuthAuditEvent {
  type:
    | 'auth.bootstrap_completed'
    | 'auth.login_succeeded'
    | 'auth.logout'
    | 'auth.recovery_used';
  timestamp: string;
  adminId: string;
}

export interface AuthPasskeyService {
  bootstrapOptions(): Promise<unknown>;
  verifyBootstrap(response: RegistrationResponseJSON): Promise<{ adminId: string }>;
  loginOptions(): Promise<unknown>;
  verifyLogin(response: AuthenticationResponseJSON): Promise<{ adminId: string }>;
}

export interface AuthRouteOptions {
  passkeys: AuthPasskeyService;
  sessions: SessionService;
  recovery: RecoveryService;
  secureCookies: boolean;
  audit?: { append(event: AuthAuditEvent): Promise<void> };
  now?: () => Date;
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const cookie = request.headers.cookie;
  for (const part of cookie?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function cookieAttributes(secure: boolean, httpOnly: boolean): string {
  return [
    'Path=/',
    httpOnly ? 'HttpOnly' : undefined,
    'SameSite=Strict',
    secure ? 'Secure' : undefined,
  ]
    .filter((part) => part !== undefined)
    .join('; ');
}

function setSessionCookies(
  reply: FastifyReply,
  plaintext: string,
  csrfToken: string,
  secure: boolean,
): void {
  reply.header(
    'set-cookie',
    [
      `amcp_admin=${plaintext}; ${cookieAttributes(secure, true)}`,
      `amcp_csrf=${csrfToken}; ${cookieAttributes(secure, false)}`,
    ],
  );
}

async function audit(
  options: AuthRouteOptions,
  event: Omit<AuthAuditEvent, 'timestamp'>,
): Promise<void> {
  await options.audit?.append({
    ...event,
    timestamp: (options.now?.() ?? new Date()).toISOString(),
  });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const recoveryAttempts = new Map<string, { startedAt: number; count: number }>();
  const recoveryWindowMs = 60_000;
  const recoveryAttemptsPerWindow = 5;
  app.post('/api/auth/bootstrap/options', async () =>
    options.passkeys.bootstrapOptions(),
  );

  app.post('/api/auth/bootstrap/verify', async (request, reply) => {
    const credential = await options.passkeys.verifyBootstrap(
      request.body as RegistrationResponseJSON,
    );
    const session = await options.sessions.create(credential.adminId);
    const recoveryCodes = await options.recovery.generate();
    setSessionCookies(
      reply,
      session.plaintext,
      session.csrfToken,
      options.secureCookies,
    );
    await audit(options, {
      type: 'auth.bootstrap_completed',
      adminId: credential.adminId,
    });
    return { csrfToken: session.csrfToken, recoveryCodes };
  });

  app.post('/api/auth/login/options', async () =>
    options.passkeys.loginOptions(),
  );

  app.get('/api/auth/session', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const plaintext = cookieValue(request, 'amcp_admin');
    const session =
      plaintext === undefined
        ? undefined
        : await options.sessions.authenticate(plaintext);
    if (session === undefined) {
      reply.code(401);
      return {
        error: {
          code: 'auth.unauthorized',
          message: 'Authentication is required',
          requestId: request.id,
        },
      };
    }
    return { authenticated: true };
  });

  app.post('/api/auth/login/verify', async (request, reply) => {
    const credential = await options.passkeys.verifyLogin(
      request.body as AuthenticationResponseJSON,
    );
    const session = await options.sessions.create(credential.adminId);
    setSessionCookies(
      reply,
      session.plaintext,
      session.csrfToken,
      options.secureCookies,
    );
    await audit(options, {
      type: 'auth.login_succeeded',
      adminId: credential.adminId,
    });
    return { csrfToken: session.csrfToken };
  });

  app.post('/api/auth/recovery', async (request, reply) => {
    const now = (options.now?.() ?? new Date()).getTime();
    const previous = recoveryAttempts.get(request.ip);
    const attempt =
      previous === undefined || now - previous.startedAt >= recoveryWindowMs
        ? { startedAt: now, count: 1 }
        : { ...previous, count: previous.count + 1 };
    recoveryAttempts.set(request.ip, attempt);
    if (attempt.count > recoveryAttemptsPerWindow) {
      reply.code(429).header('retry-after', '60');
      return { error: 'recovery_rate_limited' };
    }
    const body = request.body as { code?: unknown };
    if (typeof body.code !== 'string' || !(await options.recovery.consume(body.code))) {
      reply.code(401);
      return { error: 'invalid_recovery_code' };
    }
    await options.sessions.repository.revokeAll();
    const session = await options.sessions.create('admin');
    setSessionCookies(
      reply,
      session.plaintext,
      session.csrfToken,
      options.secureCookies,
    );
    await audit(options, { type: 'auth.recovery_used', adminId: 'admin' });
    return {
      csrfToken: session.csrfToken,
      requiresPasskeyRegistration: true,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const plaintext = cookieValue(request, 'amcp_admin');
    const csrf = request.headers['x-csrf-token'];
    const session =
      plaintext === undefined || typeof csrf !== 'string'
        ? undefined
        : await options.sessions.authenticate(plaintext, csrf);
    if (session === undefined) {
      reply.code(403);
      return { error: 'csrf_or_session_invalid' };
    }
    await options.sessions.revoke(session.id);
    reply.header(
      'set-cookie',
      [
        `amcp_admin=; ${cookieAttributes(options.secureCookies, true)}; Max-Age=0`,
        `amcp_csrf=; ${cookieAttributes(options.secureCookies, false)}; Max-Age=0`,
      ],
    );
    await audit(options, { type: 'auth.logout', adminId: session.adminId });
    return { ok: true };
  });
}
