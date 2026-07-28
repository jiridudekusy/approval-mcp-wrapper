import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import {
  InMemorySessionRepository,
  SessionService,
} from './session-store.js';
import {
  InMemoryRecoveryRepository,
  RecoveryService,
} from './recovery-service.js';
import { buildServerApp } from './app.js';

describe('server configuration', () => {
  const masterKey = Buffer.alloc(32, 7).toString('base64');

  it('requires HTTPS outside exact loopback development hosts', () => {
    expect(() =>
      loadConfig({
        APPROVAL_MCP_PUBLIC_URL: 'http://example.test',
        APPROVAL_MCP_DATA_DIR: '/tmp/data',
        APPROVAL_MCP_MASTER_KEY: masterKey,
      }),
    ).toThrow('HTTPS');
    expect(
      loadConfig({
        APPROVAL_MCP_PUBLIC_URL: 'http://localhost:3000',
        APPROVAL_MCP_DATA_DIR: '/tmp/data',
        APPROVAL_MCP_MASTER_KEY: masterKey,
      }).rpId,
    ).toBe('localhost');
  });
});

describe('SessionService', () => {
  it('stores only a hash and requires the matching CSRF token', async () => {
    const repository = new InMemorySessionRepository();
    const service = new SessionService(repository);
    const created = await service.create('admin-1');
    const stored = await repository.find(created.id);

    expect(JSON.stringify(stored)).not.toContain(created.plaintext);
    expect(JSON.stringify(stored)).not.toContain(created.csrfToken);
    await expect(
      service.authenticate(created.plaintext, created.csrfToken),
    ).resolves.toMatchObject({ adminId: 'admin-1' });
    await expect(
      service.authenticate(created.plaintext, 'wrong'),
    ).resolves.toBeUndefined();
  });
});

describe('RecoveryService', () => {
  it('returns ten codes once and consumes each code at most once', async () => {
    const repository = new InMemoryRecoveryRepository();
    const service = new RecoveryService(repository);
    const codes = await service.generate();

    expect(codes).toHaveLength(10);
    expect(JSON.stringify(await repository.list())).not.toContain(codes[0]);
    await expect(service.consume(codes[0]!)).resolves.toBe(true);
    await expect(service.consume(codes[0]!)).resolves.toBe(false);
  });
});

describe('authentication routes', () => {
  it('sets a hardened session cookie and enforces CSRF on logout', async () => {
    const sessions = new SessionService(new InMemorySessionRepository());
    const app = await buildServerApp({
      auth: {
        passkeys: {
          bootstrapOptions: async () => ({ challenge: 'challenge' }),
          verifyBootstrap: async () => ({ adminId: 'admin' }),
          loginOptions: async () => ({ challenge: 'challenge' }),
          verifyLogin: async () => ({ adminId: 'admin' }),
        },
        sessions,
        recovery: new RecoveryService(new InMemoryRecoveryRepository()),
        secureCookies: true,
      },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login/verify',
      payload: {},
    });
    const cookie = login.headers['set-cookie'];
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: cookie ?? '' },
      }),
    ).toHaveProperty('statusCode', 403);
    expect(
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie: cookie ?? '',
          'x-csrf-token': csrfToken,
        },
      }),
    ).toHaveProperty('statusCode', 200);
    await app.close();
  });
});
