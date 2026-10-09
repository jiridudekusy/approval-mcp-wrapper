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
  it('detects newly added tools on the live connection without restarting it', async () => {
    const listTools = vi.fn()
      .mockResolvedValueOnce({ tools: [{ name: 'old', inputSchema: {} }] })
      .mockResolvedValueOnce({ tools: [{ name: 'old', inputSchema: {} }] })
      .mockResolvedValueOnce({ tools: [
        { name: 'old', inputSchema: {} },
        { name: 'new', inputSchema: {} },
      ] });
    const connection: McpConnection = {
      listTools,
      callTool: vi.fn(),
      readResource: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const factory: McpConnectionFactory = { connect: vi.fn().mockResolvedValue(connection) };
    const registry = new UpstreamRegistry({ upstreams: [upstream()], connectionFactory: factory });
    const changed = vi.fn();
    registry.on('catalogChanged', changed);

    await registry.refresh(upstreamId);
    await registry.refresh(upstreamId);
    const catalog = await registry.refresh(upstreamId);

    expect(catalog.tools.map((tool) => tool.name)).toEqual(['new', 'old']);
    expect(factory.connect).toHaveBeenCalledTimes(1);
    expect(connection.close).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('reconnects after a failed live discovery and does not replace a good catalog on failure', async () => {
    const first: McpConnection = {
      listTools: vi.fn()
        .mockResolvedValueOnce({ tools: [{ name: 'old', inputSchema: {} }] })
        .mockRejectedValueOnce(new Error('connection lost')),
      callTool: vi.fn(), readResource: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
    };
    const second: McpConnection = {
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'new', inputSchema: {} }] }),
      callTool: vi.fn(), readResource: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
    };
    const factory: McpConnectionFactory = {
      connect: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
    };
    const registry = new UpstreamRegistry({ upstreams: [upstream()], connectionFactory: factory });

    await registry.refresh(upstreamId);
    const catalog = await registry.refresh(upstreamId);

    expect(catalog.tools.map((tool) => tool.name)).toEqual(['new']);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(factory.connect).toHaveBeenCalledTimes(2);
  });

  it('uses a fresh connection after upstream settings change', async () => {
    const first: McpConnection = {
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'old', inputSchema: {} }] }),
      callTool: vi.fn(), readResource: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
    };
    const second: McpConnection = {
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'new', inputSchema: {} }] }),
      callTool: vi.fn(), readResource: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
    };
    const factory: McpConnectionFactory = {
      connect: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
    };
    const registry = new UpstreamRegistry({ upstreams: [upstream()], connectionFactory: factory });

    await registry.refresh(upstreamId);
    await registry.replaceUpstreams([{ ...upstream(), url: 'https://other.example.test/mcp' }]);
    const catalog = await registry.refresh(upstreamId);

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(factory.connect).toHaveBeenCalledTimes(2);
    expect(catalog.tools.map((tool) => tool.name)).toEqual(['new']);
  });

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
      readResource: vi.fn(),
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

    await registry.readResource({
      upstreamId,
      uri: 'minutes://conversations/family',
      timeoutMs: 3_000,
    });
    expect(connection.readResource).toHaveBeenCalledWith(
      { uri: 'minutes://conversations/family' },
      { timeoutMs: 3_000 },
    );
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
        readResource: vi.fn(),
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
