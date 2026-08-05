import { randomBytes } from 'node:crypto';

import type { Upstream, UpstreamId } from '@approval-mcp/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CredentialVault,
  type McpConnection,
  type McpConnectionFactory,
  UpstreamRegistry,
} from './index.js';

const upstreamId = 'upstream-1' as UpstreamId;

function upstream(credentials?: Upstream['credentials']): Upstream {
  const now = new Date(0).toISOString();
  return {
    id: upstreamId,
    alias: 'calendar',
    url: 'https://mcp.example.test/rpc',
    allowPrivateNetwork: false,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...(credentials === undefined ? {} : { credentials }),
  };
}

describe('CredentialVault', () => {
  it('encrypts credentials with upstream-bound authenticated metadata', () => {
    const vault = new CredentialVault(randomBytes(32));
    const envelope = vault.encrypt(upstreamId, {
      authorization: 'Bearer upstream-secret',
    });

    expect(JSON.stringify(envelope)).not.toContain('upstream-secret');
    expect(vault.decrypt(upstreamId, envelope)).toEqual({
      authorization: 'Bearer upstream-secret',
    });
    expect(() =>
      vault.decrypt('another-upstream' as UpstreamId, envelope),
    ).toThrow();
  });
});

describe('UpstreamRegistry', () => {
  it('discovers a deterministic catalog and forwards tool calls', async () => {
    const connection: McpConnection = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'zeta',
            description: 'Last',
            inputSchema: { type: 'object' },
          },
          {
            name: 'alpha',
            description: 'First',
            inputSchema: { type: 'object' },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'done' }],
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const factory: McpConnectionFactory = {
      connect: vi.fn().mockResolvedValue(connection),
    };
    const registry = new UpstreamRegistry({
      upstreams: [upstream()],
      connectionFactory: factory,
    });
    const signal = new AbortController().signal;

    const catalog = await registry.refresh(upstreamId);
    const result = await registry.call({
      upstreamId,
      toolName: 'alpha',
      arguments: { downstreamAuthorization: 'must-not-be-forwarded' },
      signal,
      timeoutMs: 120_000,
    });

    expect(catalog.tools.map((tool) => tool.name)).toEqual(['alpha', 'zeta']);
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }] });
    expect(connection.callTool).toHaveBeenCalledWith(
      {
        name: 'alpha',
        arguments: { downstreamAuthorization: 'must-not-be-forwarded' },
      },
      { signal, timeoutMs: 120_000 },
    );
    expect(registry.health(upstreamId).status).toBe('healthy');
  });

  it('decrypts only upstream credentials for the connection adapter', async () => {
    const vault = new CredentialVault(randomBytes(32));
    const credentials = vault.encrypt(upstreamId, {
      authorization: 'Bearer upstream-only',
    });
    const factory: McpConnectionFactory = {
      connect: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        callTool: vi.fn(),
        close: vi.fn(),
      }),
    };
    const registry = new UpstreamRegistry({
      upstreams: [upstream(credentials)],
      connectionFactory: factory,
      credentialVault: vault,
    });

    await registry.refresh(upstreamId);

    expect(factory.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { authorization: 'Bearer upstream-only' },
      }),
    );
  });

  it('marks an upstream unhealthy after a connection failure', async () => {
    const registry = new UpstreamRegistry({
      upstreams: [upstream()],
      connectionFactory: {
        connect: vi.fn().mockRejectedValue(new Error('network unavailable')),
      },
    });

    await expect(registry.refresh(upstreamId)).rejects.toThrow(
      'network unavailable',
    );
    expect(registry.health(upstreamId)).toMatchObject({
      status: 'unhealthy',
      error: 'network unavailable',
    });
  });
});
