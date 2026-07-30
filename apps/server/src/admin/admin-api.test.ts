import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConfigStateStore } from '@approval-mcp/state-store';
import { CredentialVault } from '@approval-mcp/upstream';
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

async function fixture(options?: {
  discoverTools?(upstreamId: string): Promise<{
    upstreamId: string;
    refreshedAt: string;
    tools: readonly {
      name: string;
      inputSchema: Record<string, unknown>;
    }[];
  }>;
  onUpstreamsChanged?(): Promise<void>;
}) {
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
    discoverTools: options?.discoverTools,
    credentialVault: new CredentialVault(Buffer.alloc(32, 7)),
    onUpstreamsChanged: options?.onUpstreamsChanged,
  });
  apps.push(app);
  return {
    app,
    authHeaders: {
      cookie: `amcp_admin=${session.plaintext}`,
      'x-csrf-token': session.csrfToken,
    },
    store,
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

  it('lists reusable active grants with display names and revokes them', async () => {
    const { app, authHeaders, store } = await fixture();
    const now = '2026-07-30T08:28:22.098Z';
    const activeGrant = {
      id: 'grant-hour',
      clientTokenId: 'token-1',
      upstreamId: 'upstream-1',
      toolName: 'get_conversations',
      predicates: [{ path: '/groupId', operator: 'exists' }],
      expiresAt: '2099-07-30T09:28:22.098Z',
      normalizationVersion: 1,
      approvedBy: 'admin',
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await store.mutate({
      type: 'records.batch',
      operations: [
        {
          type: 'record.upserted',
          collection: 'clientTokens',
          id: 'token-1',
          value: {
            id: 'token-1',
            label: 'Claude Code',
            verifier: 'not-returned',
            schemaVersion: 1,
            createdAt: now,
            updatedAt: now,
            version: 1,
          },
        },
        {
          type: 'record.upserted',
          collection: 'upstreams',
          id: 'upstream-1',
          value: {
            id: 'upstream-1',
            alias: 'signal',
            url: 'https://signal.example/mcp',
            allowPrivateNetwork: false,
            schemaVersion: 1,
            createdAt: now,
            updatedAt: now,
            version: 1,
          },
        },
        {
          type: 'record.upserted',
          collection: 'grants',
          id: activeGrant.id,
          value: activeGrant,
        },
        {
          type: 'record.upserted',
          collection: 'grants',
          id: 'grant-expired',
          value: {
            ...activeGrant,
            id: 'grant-expired',
            expiresAt: '2020-01-01T00:00:00.000Z',
          },
        },
        {
          type: 'record.upserted',
          collection: 'grants',
          id: 'grant-once',
          value: {
            ...activeGrant,
            id: 'grant-once',
            callId: 'call-1',
            requestHash: 'hash-1',
          },
        },
      ],
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/grants',
      headers: { cookie: authHeaders.cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      expect.objectContaining({
        id: 'grant-hour',
        tokenLabel: 'Claude Code',
        upstreamAlias: 'signal',
        scope: 'until',
        version: 1,
      }),
    ]);

    const revoked = await app.inject({
      method: 'DELETE',
      url: '/api/admin/grants/grant-hour',
      headers: authHeaders,
      payload: { version: 1 },
    });
    expect(revoked.statusCode).toBe(204);
    expect(
      store.read((state) => state.grants['grant-hour']),
    ).toEqual(expect.objectContaining({
      revokedAt: expect.any(String),
      version: 2,
    }));

    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/admin/grants',
      headers: { cookie: authHeaders.cookie },
    });
    expect(afterRevoke.json()).toEqual([]);
  });

  it('discovers tools for one configured upstream', async () => {
    let discoveredId: string | undefined;
    const { app, authHeaders } = await fixture({
      discoverTools: async (upstreamId) => {
        discoveredId = upstreamId;
        return {
          upstreamId,
          refreshedAt: '2026-07-28T00:00:00.000Z',
          tools: [
            { name: 'zeta', inputSchema: { type: 'object' } },
            { name: 'alpha', inputSchema: { type: 'object' } },
          ],
        };
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/upstreams',
      headers: authHeaders,
      payload: {
        alias: 'signal',
        url: 'https://signal.example/mcp',
        allowPrivateNetwork: false,
      },
    });
    const upstreamId = created.json<{ id: string }>().id;

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/upstreams/${upstreamId}/tools`,
      headers: { cookie: authHeaders.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(discoveredId).toBe(upstreamId);
    expect(
      response.json<{ tools: { name: string }[] }>().tools.map(
        (tool) => tool.name,
      ),
    ).toEqual(['alpha', 'zeta']);
  });

  it('bounds unknown and failed upstream discovery responses', async () => {
    const { app, authHeaders } = await fixture({
      discoverTools: async () => {
        throw new Error('secret connection detail');
      },
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/admin/upstreams/missing/tools',
          headers: { cookie: authHeaders.cookie },
        })
      ).statusCode,
    ).toBe(404);
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/upstreams',
      headers: authHeaders,
      payload: {
        alias: 'offline',
        url: 'https://offline.example/mcp',
        allowPrivateNetwork: false,
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/upstreams/${created.json<{ id: string }>().id}/tools`,
      headers: { cookie: authHeaders.cookie },
    });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('secret connection detail');
  });

  it('edits upstream fields while preserving or explicitly removing credentials', async () => {
    const { app, authHeaders } = await fixture();
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/upstreams',
      headers: authHeaders,
      payload: {
        alias: 'signal',
        url: 'https://signal.example/mcp',
        allowPrivateNetwork: false,
        credentials: { authorization: 'Bearer secret' },
      },
    });
    const upstream = created.json<{ id: string; version: number }>();

    const preserved = await app.inject({
      method: 'PUT',
      url: `/api/admin/upstreams/${upstream.id}`,
      headers: authHeaders,
      payload: {
        version: upstream.version,
        alias: 'signal-home',
        url: 'https://signal.example/v2/mcp',
        allowPrivateNetwork: true,
      },
    });
    expect(preserved.statusCode).toBe(200);
    expect(preserved.json()).toMatchObject({
      alias: 'signal-home',
      allowPrivateNetwork: true,
      credentialsConfigured: true,
    });

    const removed = await app.inject({
      method: 'PUT',
      url: `/api/admin/upstreams/${upstream.id}`,
      headers: authHeaders,
      payload: {
        version: preserved.json<{ version: number }>().version,
        credentials: null,
      },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ credentialsConfigured: false });
  });

  it('previews and atomically cascades upstream deletion', async () => {
    let reloads = 0;
    const { app, authHeaders, store } = await fixture({
      onUpstreamsChanged: async () => {
        reloads += 1;
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/upstreams',
      headers: authHeaders,
      payload: {
        alias: 'signal',
        url: 'https://signal.example/mcp',
        allowPrivateNetwork: false,
      },
    });
    const upstream = created.json<{ id: string; version: number }>();
    const now = new Date().toISOString();
    await store.mutate({
      type: 'records.batch',
      operations: [
        {
          type: 'record.upserted',
          collection: 'policies',
          id: 'policy-1',
          value: {
            id: 'policy-1',
            clientTokenId: 'token-1',
            upstreamId: upstream.id,
            toolName: 'send',
            outcome: 'allow',
            predicates: [],
            enabled: true,
            schemaVersion: 1,
            createdAt: now,
            updatedAt: now,
            version: 1,
          },
        },
        {
          type: 'record.upserted',
          collection: 'grants',
          id: 'grant-1',
          value: {
            id: 'grant-1',
            clientTokenId: 'token-1',
            upstreamId: upstream.id,
            toolName: 'send',
            scope: { kind: 'forever' },
            schemaVersion: 1,
            createdAt: now,
            updatedAt: now,
            version: 1,
          },
        },
      ],
    });

    const impact = await app.inject({
      method: 'GET',
      url: `/api/admin/upstreams/${upstream.id}/deletion-impact`,
      headers: { cookie: authHeaders.cookie },
    });
    expect(impact.json()).toEqual({ policies: 1, grants: 1 });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/admin/upstreams/${upstream.id}`,
      headers: authHeaders,
      payload: { version: upstream.version },
    });
    expect(removed.statusCode).toBe(204);
    expect(
      store.read((state) => ({
        upstream: state.upstreams[upstream.id],
        policy: state.policies['policy-1'],
        grant: state.grants['grant-1'],
      })),
    ).toEqual({
      upstream: undefined,
      policy: undefined,
      grant: undefined,
    });
    expect(reloads).toBe(2);
  });
});
