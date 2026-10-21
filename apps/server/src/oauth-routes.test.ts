import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JsonValue, Profile, ProfileId } from '@approval-mcp/contracts';
import { createConfigStateStore } from '@approval-mcp/state-store';
import { describe, expect, it } from 'vitest';

import { buildServerApp } from './app.js';
import { OAuthService } from './oauth-service.js';
import { InMemoryRecoveryRepository, RecoveryService } from './recovery-service.js';
import { InMemorySessionRepository, SessionService } from './session-store.js';

it('discovers OAuth, asks the admin for passkey consent, and exchanges the code', async () => {
  const origin = 'https://approval.example.test';
  const resource = `${origin}/mcp`;
  const state = await createConfigStateStore(await mkdtemp(join(tmpdir(), 'approval-oauth-routes-')));
  const oauth = new OAuthService(state, origin);
  const now = new Date().toISOString();
  const profile: Profile = {
    id: 'test-profile' as ProfileId, name: 'Sandbox', isDefault: true,
    approvalTimeoutSeconds: 60, toolCallTimeoutSeconds: 60,
    schemaVersion: 1, createdAt: now, updatedAt: now, version: 1,
  };
  await state.mutate({ type: 'record.upserted', collection: 'profiles', id: profile.id, value: profile as unknown as JsonValue });
  const app = await buildServerApp({
    oauth,
    auth: {
      passkeys: {
        bootstrapOptions: async () => ({ challenge: 'challenge' }),
        verifyBootstrap: async () => ({ adminId: 'admin' }),
        loginOptions: async () => ({ challenge: 'challenge' }),
        verifyLogin: async () => ({ adminId: 'admin' }),
      },
      sessions: new SessionService(new InMemorySessionRepository()),
      recovery: new RecoveryService(new InMemoryRecoveryRepository()),
      secureCookies: true,
    },
  });
  const metadata = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });
  expect(metadata.json()).toMatchObject({ resource, authorization_servers: [origin] });
  const registration = await app.inject({ method: 'POST', url: '/oauth/register', payload: {
    client_name: 'Test sandbox', redirect_uris: ['http://127.0.0.1:43210/callback'], token_endpoint_auth_method: 'none',
  } });
  expect(registration.statusCode).toBe(201);
  const clientId = registration.json<{ client_id: string }>().client_id;
  const verifier = 'v'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorization = await app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: 'http://127.0.0.1:43210/callback', resource,
    response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: '123',
  })}` });
  expect(authorization.statusCode).toBe(302);
  const consentPath = authorization.headers.location as string;
  expect(consentPath).toMatch(/^\/oauth\/consent\//);
  const requestId = consentPath.split('/').at(-1)!;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login/verify', payload: {} });
  const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
  const cookieHeader = [login.headers['set-cookie']].flat().map((value) => value?.split(';')[0]).join('; ');
  const consent = await app.inject({ method: 'GET', url: `/api/oauth/requests/${requestId}`, headers: { cookie: cookieHeader } });
  expect(consent.json()).toMatchObject({ clientName: 'Test sandbox', profiles: [{ id: profile.id }] });
  const approve = await app.inject({ method: 'POST', url: `/api/oauth/requests/${requestId}/approve`,
    headers: { cookie: cookieHeader, 'x-csrf-token': csrfToken },
    payload: { profileId: profile.id, lifetimeSeconds: 3600, passkey: {} },
  });
  expect(approve.statusCode).toBe(200);
  const callback = new URL(approve.json<{ redirectTo: string }>().redirectTo);
  expect(callback.searchParams.get('state')).toBe('123');
  const token = await app.inject({ method: 'POST', url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ grant_type: 'authorization_code', code: callback.searchParams.get('code')!,
      client_id: clientId, redirect_uri: 'http://127.0.0.1:43210/callback', code_verifier: verifier, resource }).toString(),
  });
  expect(token.statusCode).toBe(200);
  expect(oauth.authenticate(token.json<{ access_token: string }>().access_token)).toBeDefined();
  await app.close();
  await state.close();
});
