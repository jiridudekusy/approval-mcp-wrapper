import { createServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod/v4';

import { DefaultAddressPolicy } from './address-policy.js';
import {
  createPinnedFetch,
  OfficialMcpConnectionFactory,
  type ResolveHost,
} from './mcp-client.js';

const servers: ReturnType<typeof createServer>[] = [];
const mcpHandlers: ReturnType<typeof createMcpHandler>[] = [];

afterEach(async () => {
  await Promise.all(mcpHandlers.splice(0).map((handler) => handler.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

async function listen(
  handler: Parameters<typeof createServer>[0],
): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const result = server.address();
  if (result === null || typeof result === 'string') {
    throw new Error('Expected a TCP server address');
  }
  return result.port;
}

describe('OfficialMcpConnectionFactory', () => {
  it('negotiates the modern protocol with a modern-only upstream', async () => {
    const mcpHandler = createMcpHandler(
      () => {
        const server = new McpServer({
          name: 'modern-only-upstream',
          version: '1.0.0',
        });
        server.registerTool(
          'modern_echo',
          { inputSchema: z.object({ value: z.string() }) },
          ({ value }) => ({
            content: [{ type: 'text', text: value }],
          }),
        );
        return server;
      },
      { legacy: 'reject' },
    );
    mcpHandlers.push(mcpHandler);
    const nodeHandler = toNodeHandler(mcpHandler);
    const port = await listen((request, response) => {
      void nodeHandler(request, response);
    });
    const factory = new OfficialMcpConnectionFactory({
      resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    const connection = await factory.connect({
      url: new URL(`http://modern.internal:${port}/mcp`),
      allowPrivateNetwork: true,
    });
    try {
      await expect(connection.listTools()).resolves.toMatchObject({
        tools: [{ name: 'modern_echo' }],
      });
      await expect(
        connection.callTool({
          name: 'modern_echo',
          arguments: { value: 'modern-ok' },
        }),
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: 'modern-ok' }],
      });
    } finally {
      await connection.close();
    }
  });
});

describe('createPinnedFetch', () => {
  it('validates a redirect target before opening its connection', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(302, {
        location: 'http://metadata.internal/latest/meta-data',
      });
      response.end();
    });
    const resolveHost: ResolveHost = async (hostname) =>
      hostname === 'metadata.internal'
        ? [{ address: '169.254.169.254', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];
    const safeFetch = createPinnedFetch({
      addressPolicy: new DefaultAddressPolicy(),
      resolveHost,
      rules: { allowPrivateNetwork: true },
    });

    await expect(safeFetch(`http://upstream.internal:${port}`)).rejects.toThrow(
      'metadata',
    );
  });

  it('re-resolves and revalidates the hostname for every connection', async () => {
    const port = await listen((_request, response) => response.end('ok'));
    let resolution = 0;
    const safeFetch = createPinnedFetch({
      addressPolicy: new DefaultAddressPolicy(),
      resolveHost: async () => {
        resolution += 1;
        return resolution === 1
          ? [{ address: '127.0.0.1', family: 4 }]
          : [{ address: '169.254.169.254', family: 4 }];
      },
      rules: { allowPrivateNetwork: true },
    });

    await expect(safeFetch(`http://changing.internal:${port}`)).resolves.toHaveProperty(
      'status',
      200,
    );
    await expect(safeFetch(`http://changing.internal:${port}`)).rejects.toThrow(
      'metadata',
    );
  });

  it('refuses to forward credentials across origins', async () => {
    let receivedAuthorization: string | undefined;
    const receiverPort = await listen((request, response) => {
      receivedAuthorization = request.headers.authorization;
      response.end('ok');
    });
    const redirectPort = await listen((_request, response) => {
      response.writeHead(302, {
        location: `http://receiver.internal:${receiverPort}/collect`,
      });
      response.end();
    });
    const safeFetch = createPinnedFetch({
      addressPolicy: new DefaultAddressPolicy(),
      resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
      rules: { allowPrivateNetwork: true },
    });

    await expect(
      safeFetch(`http://upstream.internal:${redirectPort}/mcp`, {
        headers: { authorization: 'Bearer upstream-secret' },
      }),
    ).rejects.toThrow('Cross-origin upstream redirect');
    expect(receivedAuthorization).toBeUndefined();
  });

  it('rejects an upstream response above the configured byte limit', async () => {
    const port = await listen((_request, response) => {
      response.end('0123456789');
    });
    const safeFetch = createPinnedFetch({
      addressPolicy: new DefaultAddressPolicy(),
      resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
      rules: { allowPrivateNetwork: true },
      maxResponseBytes: 5,
    });

    await expect(
      safeFetch(`http://upstream.internal:${port}/mcp`),
    ).rejects.toThrow('response exceeds 5 bytes');
  });
});
