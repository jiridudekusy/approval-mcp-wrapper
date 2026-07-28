import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConfigStateStore } from '@approval-mcp/state-store';
import {
  StateStoreTokenRepository,
  TokenService,
} from '@approval-mcp/gateway';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServerApp } from '../app.js';
import {
  InMemoryRecoveryRepository,
  RecoveryService,
} from '../recovery-service.js';
import {
  InMemorySessionRepository,
  SessionService,
} from '../session-store.js';
import { registerAdminRoutes } from './index.js';

const apps: Awaited<ReturnType<typeof buildServerApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const store = await createConfigStateStore(
    await mkdtemp(join(tmpdir(), 'approval-admin-api-')),
  );
  const sessions = new SessionService(new InMemorySessionRepository());
  const session = await sessions.create('admin');
  const app = await buildServerApp({
    auth: {
      passkeys: {
        bootstrapOptions: async () => ({}),
        verifyBootstrap: async () => ({ adminId: 'admin' }),
        loginOptions: async () => ({}),
        verifyLogin: async () => ({ adminId: 'admin' }),
      },
      sessions,
      recovery: new RecoveryService(new InMemoryRecoveryRepository()),
      secureCookies: true,
    },
  });
  await registerAdminRoutes(app, {
    sessions,
    state: store,
    tokens: new TokenService(new StateStoreTokenRepository(store)),
  });
  apps.push(app);
  return {
    app,
    authHeaders: {
      cookie: `amcp_admin=${session.plaintext}`,
      'x-csrf-token': session.csrfToken,
    },
  };
}

describe('admin API', () => {
  it('rejects unauthenticated requests and requires CSRF on mutations', async () => {
    const { app, authHeaders } = await fixture();

    expect((await app.inject('/api/admin/tokens')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/tokens',
          headers: { cookie: authHeaders.cookie },
          payload: { label: 'Agent' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('shows a new token once and never serializes its verifier', async () => {
    const { app, authHeaders } = await fixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/tokens',
      headers: authHeaders,
      payload: { label: 'Agent' },
    });
    const plaintext = created.json<{ plaintext: string }>().plaintext;

    expect(plaintext).toMatch(/^amcp_/);
    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/tokens',
      headers: { cookie: authHeaders.cookie },
    });
    expect(listed.body).not.toContain(plaintext);
    expect(listed.body).not.toContain('scrypt$');
    expect(listed.json()).toEqual([
      expect.objectContaining({ label: 'Agent' }),
    ]);
  });
});
