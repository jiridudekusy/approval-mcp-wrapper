import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AuthPasskeyService } from './auth-routes.js';
import { OAuthError, OAuthService } from './oauth-service.js';
import type { SessionService } from './session-store.js';
import { authorizeAdmin } from './admin/authorization.js';

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function oauthFailure(reply: FastifyReply, error: unknown): unknown {
  const failure = error instanceof OAuthError ? error : new OAuthError('server_error', 500);
  return reply.code(failure.status).header('cache-control', 'no-store').send({ error: failure.code });
}

export async function registerOAuthRoutes(app: FastifyInstance, options: {
  oauth: OAuthService;
  passkeys: AuthPasskeyService;
  sessions: SessionService;
}): Promise<void> {
  const { oauth } = options;
  function requestOrigin(request: FastifyRequest, reply: FastifyReply): string | undefined {
    const origin = oauth.originForHost(request.headers.host);
    if (origin === undefined) reply.code(421).header('cache-control', 'no-store').send({ error: 'invalid_host' });
    return origin;
  }
  const registrationAttempts = new Map<string, { startedAt: number; count: number }>();
  const authorizationAttempts = new Map<string, { startedAt: number; count: number }>();
  function rateLimited(attempts: Map<string, { startedAt: number; count: number }>, ip: string, limit: number): boolean {
    const now = Date.now();
    const previous = attempts.get(ip);
    const attempt = previous === undefined || now - previous.startedAt > 60 * 60_000
      ? { startedAt: now, count: 1 }
      : { ...previous, count: previous.count + 1 };
    attempts.set(ip, attempt);
    return attempt.count > limit;
  }
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.get('/.well-known/oauth-protected-resource/mcp', async (request, reply) => {
    const origin = requestOrigin(request, reply);
    if (origin === undefined) return;
    reply.header('cache-control', 'public, max-age=300');
    return { resource: oauth.resourceFor(origin), authorization_servers: [origin], scopes_supported: ['mcp:access'] };
  });
  app.get('/.well-known/oauth-protected-resource', async (request, reply) => {
    const origin = requestOrigin(request, reply);
    if (origin === undefined) return;
    reply.header('cache-control', 'public, max-age=300');
    return { resource: oauth.resourceFor(origin), authorization_servers: [origin], scopes_supported: ['mcp:access'] };
  });
  app.get('/.well-known/oauth-authorization-server', async (request, reply) => {
    const origin = requestOrigin(request, reply);
    if (origin === undefined) return;
    reply.header('cache-control', 'public, max-age=300');
    return {
      issuer: origin,
      authorization_endpoint: `${oauth.issuer}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp:access'],
      authorization_response_iss_parameter_supported: true,
    };
  });

  app.post('/oauth/register', async (request, reply) => {
    const origin = requestOrigin(request, reply);
    if (origin === undefined) return;
    if (rateLimited(registrationAttempts, request.ip, 20)) return oauthFailure(reply, new OAuthError('rate_limited', 429));
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body['token_endpoint_auth_method'] !== undefined && body['token_endpoint_auth_method'] !== 'none') {
      return oauthFailure(reply, new OAuthError('invalid_client_metadata'));
    }
    if (!Array.isArray(body['redirect_uris']) || !body['redirect_uris'].every((uri) => typeof uri === 'string')) {
      return oauthFailure(reply, new OAuthError('invalid_client_metadata'));
    }
    try {
      const client = await oauth.registerClient(string(body['client_name']) ?? 'Unnamed MCP client', body['redirect_uris'], origin);
      return reply.code(201).header('cache-control', 'no-store').send({
        client_id: client.id, client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        client_name: client.name, redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
      });
    } catch (error) { return oauthFailure(reply, error); }
  });

  app.get('/oauth/authorize', async (request, reply) => {
    if (rateLimited(authorizationAttempts, request.ip, 120)) return oauthFailure(reply, new OAuthError('rate_limited', 429));
    const query = request.query as Record<string, unknown>;
    try {
      const id = await oauth.request({
        clientId: string(query['client_id']) ?? '', redirectUri: string(query['redirect_uri']) ?? '',
        resource: string(query['resource']) ?? '', responseType: string(query['response_type']) ?? '',
        codeChallenge: string(query['code_challenge']) ?? '',
        codeChallengeMethod: string(query['code_challenge_method']) ?? '',
        ...(query['scope'] === undefined ? {} : { scope: string(query['scope']) ?? '' }),
        ...(query['state'] === undefined ? {} : { state: string(query['state']) ?? '' }),
      });
      return reply.code(302).header('cache-control', 'no-store').redirect(`/oauth/consent/${id}`);
    } catch (error) { return oauthFailure(reply, error); }
  });

  app.post('/oauth/token', async (request, reply) => {
    const origin = requestOrigin(request, reply);
    if (origin === undefined) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      const grantType = string(body['grant_type']);
      const result = grantType === 'authorization_code'
        ? await oauth.exchangeCode({
          code: string(body['code']) ?? '', clientId: string(body['client_id']) ?? '',
          redirectUri: string(body['redirect_uri']) ?? '', resource: string(body['resource']) ?? '',
          codeVerifier: string(body['code_verifier']) ?? '', issuer: origin,
        })
        : grantType === 'refresh_token'
          ? await oauth.refresh({
            refreshToken: string(body['refresh_token']) ?? '', clientId: string(body['client_id']) ?? '',
            resource: string(body['resource']) ?? '', issuer: origin,
          })
          : undefined;
      if (result === undefined) throw new OAuthError('unsupported_grant_type');
      return reply.header('cache-control', 'no-store').header('pragma', 'no-cache').send(result);
    } catch (error) { return oauthFailure(reply, error); }
  });

  app.get('/api/oauth/requests/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    try {
      const { id } = request.params as { id: string };
      return reply.header('cache-control', 'no-store').send(oauth.pending(id));
    } catch (error) { return oauthFailure(reply, error); }
  });

  app.post('/api/oauth/requests/:id/approve', async (request, reply) => {
    const session = await authorizeAdmin(request, reply, options.sessions, true);
    if (session === undefined) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { profileId?: unknown; lifetimeSeconds?: unknown; label?: unknown; passkey?: unknown };
    if (typeof body.profileId !== 'string' || typeof body.lifetimeSeconds !== 'number' ||
      (body.label !== undefined && typeof body.label !== 'string') ||
      typeof body.passkey !== 'object' || body.passkey === null) {
      return oauthFailure(reply, new OAuthError('invalid_request'));
    }
    try {
      oauth.pending(id);
      const verified = await options.passkeys.verifyLogin(body.passkey as AuthenticationResponseJSON);
      if (verified.adminId !== session.adminId) throw new OAuthError('access_denied', 403);
      const redirectTo = await oauth.approve(id, body.profileId, body.lifetimeSeconds, session.adminId, body.label as string | undefined);
      return reply.header('cache-control', 'no-store').send({ redirectTo });
    } catch (error) { return oauthFailure(reply, error); }
  });

  app.post('/api/oauth/requests/:id/deny', async (request, reply) => {
    const session = await authorizeAdmin(request, reply, options.sessions, true);
    if (session === undefined) return;
    try {
      const { id } = request.params as { id: string };
      const redirectTo = await oauth.deny(id, session.adminId);
      return reply.header('cache-control', 'no-store').send({ redirectTo });
    } catch (error) { return oauthFailure(reply, error); }
  });
}
