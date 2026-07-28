import type { ClientTokenId, UpstreamId } from '@approval-mcp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  buildTokenCatalog,
  GatewayError,
  TokenScopedGateway,
  validateOrigin,
  createMcpHttpHandler,
} from './index.js';

const tokenA = 'token-a' as ClientTokenId;
const tokenB = 'token-b' as ClientTokenId;
const upstreamId = 'upstream-1' as UpstreamId;
const tools = [
  {
    upstreamId,
    upstreamAlias: 'signal',
    tool: { name: 'send_message', inputSchema: { type: 'object' } },
  },
  {
    upstreamId,
    upstreamAlias: 'signal',
    tool: { name: 'list_groups', inputSchema: { type: 'object' } },
  },
];

describe('token-scoped catalog', () => {
  it('returns deterministic and isolated tool lists for two tokens', () => {
    const visible = new Map([
      [tokenA, new Set(['signal__send_message'])],
      [tokenB, new Set(['signal__list_groups'])],
    ]);

    expect(buildTokenCatalog(tokenA, tools, visible).map((item) => item.name)).toEqual([
      'signal__send_message',
    ]);
    expect(buildTokenCatalog(tokenB, tools, visible).map((item) => item.name)).toEqual([
      'signal__list_groups',
    ]);
  });

  it('rejects ambiguous aliases', () => {
    expect(() =>
      buildTokenCatalog(
        tokenA,
        [{ ...tools[0]!, upstreamAlias: 'bad__alias' }],
        new Map([[tokenA, new Set(['bad__alias__send_message'])]]),
      ),
    ).toThrow('alias');
  });
});

describe('TokenScopedGateway', () => {
  it('returns the same public error for hidden and unknown tool guesses', async () => {
    const coordinator = { call: vi.fn() };
    const gateway = new TokenScopedGateway({
      coordinator,
      catalogFor: () => buildTokenCatalog(tokenA, tools, new Map([
        [tokenA, new Set(['signal__list_groups'])],
      ])),
    });

    const hidden = gateway.call(tokenA, 'signal__send_message', {}, new AbortController().signal);
    const unknown = gateway.call(tokenA, 'signal__does_not_exist', {}, new AbortController().signal);

    await expect(hidden).rejects.toMatchObject({ code: 'tool_not_found' });
    await expect(unknown).rejects.toMatchObject({ code: 'tool_not_found' });
    expect(coordinator.call).not.toHaveBeenCalled();
  });
});

describe('validateOrigin', () => {
  it('allows configured origins and rejects missing or foreign origins', () => {
    expect(() =>
      validateOrigin('https://admin.example.test', [
        'https://admin.example.test',
      ]),
    ).not.toThrow();
    expect(() => validateOrigin(undefined, ['https://admin.example.test'])).toThrow(
      GatewayError,
    );
    expect(() =>
      validateOrigin('https://evil.example.test', [
        'https://admin.example.test',
      ]),
    ).toThrow('Origin');
  });
});

describe('Streamable HTTP MCP integration', () => {
  it('authenticates, lists a scoped catalog, and hands off a tool call', async () => {
    const coordinator = {
      call: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      }),
    };
    const gateway = new TokenScopedGateway({
      coordinator,
      catalogFor: () =>
        buildTokenCatalog(
          tokenA,
          tools,
          new Map([[tokenA, new Set(['signal__list_groups'])]]),
        ),
    });
    const handler = createMcpHttpHandler({
      allowedOrigins: ['https://admin.example.test'],
      authenticate: async (token) => (token === 'valid' ? tokenA : undefined),
      gateway,
    });
    const server = createServer((request, response) => {
      void handler(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP server address');
    }
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      {
        requestInit: {
          headers: {
            authorization: 'Bearer valid',
            origin: 'https://admin.example.test',
          },
        },
      },
    );
    const client = new Client(
      { name: 'gateway-test', version: '1.0.0' },
      { capabilities: {} },
    );
    try {
      await client.connect(transport as Transport);
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [{ name: 'signal__list_groups' }],
      });
      await expect(
        client.callTool({ name: 'signal__list_groups', arguments: {} }),
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: 'ok' }],
      });
      expect(coordinator.call).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });
});
