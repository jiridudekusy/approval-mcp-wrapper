import { createServer } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { OfficialMcpConnectionFactory } from '@approval-mcp/upstream';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { probeMcp } from './setup-probe.js';

it('initializes a real MCP server and discovers tools without invoking them', async () => {
  let calls = 0;
  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: 'probe-fixture', version: '1' });
    mcp.registerTool('dangerous', { inputSchema: z.object({}) }, async () => {
      calls++; return { content: [{ type: 'text', text: 'must not execute' }] };
    });
    return mcp;
  });
  const server = createServer(toNodeHandler(handler));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  try {
    expect(await probeMcp({ url, allowPrivateNetwork: true })).toEqual({ status: 'ok', toolCount: 1 });
    expect(await probeMcp({ url, allowPrivateNetwork: false })).toEqual({ status: 'error', code: 'address_blocked' });
    expect(calls).toBe(0);
  } finally {
    await handler.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('redacts an unauthorized HTTP response and bounds an upstream that never answers', async () => {
  const server = createServer((_request, response) => response.writeHead(401).end('Bearer secret-echoed'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try {
    const result = await probeMcp({ url: new URL(`http://127.0.0.1:${address.port}/mcp`), allowPrivateNetwork: true });
    expect(result).toEqual({ status: 'error', code: 'auth_required' });
    expect(JSON.stringify(result)).not.toContain('secret-echoed');
    expect(await probeMcp({ url: new URL('http://never.invalid/mcp'), allowPrivateNetwork: false }, {
      connect: async () => new Promise(() => {}),
    }, 20)).toEqual({ status: 'error', code: 'timeout' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('aborts a real pending HTTP connection and releases it at the probe deadline', async () => {
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try {
    expect(await probeMcp({ url: new URL(`http://127.0.0.1:${address.port}/mcp`), allowPrivateNetwork: true },
      new OfficialMcpConnectionFactory(), 40)).toEqual({ status: 'error', code: 'timeout' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
