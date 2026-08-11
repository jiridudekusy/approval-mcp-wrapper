import { createServer } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 37221);

function createMcpServer() {
  const server = new McpServer({
    name: 'approval-test-mcp',
    version: '1.0.0',
  });

  server.registerTool('preview_release', {
    title: 'Preview release',
    description: 'Build a harmless preview of a release without changing anything.',
    inputSchema: {
      service: z.string().min(1),
      version: z.string().min(1),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  }, async ({ service, version }) => ({
    content: [{
      type: 'text',
      text: `Preview ready for ${service} ${version}. No deployment was performed.`,
    }],
  }));

  server.registerTool('deploy_release', {
    title: 'Deploy release',
    description: 'Simulate a production deployment. This test server never changes a real system.',
    inputSchema: {
      service: z.string().min(1),
      version: z.string().min(1),
      environment: z.enum(['staging', 'production']),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  }, async ({ service, version, environment }) => ({
    content: [{
      type: 'text',
      text: `Simulated deployment of ${service} ${version} to ${environment}.`,
    }],
  }));

  return server;
}

const httpServer = createServer((request, response) => {
  if (request.url !== '/mcp') {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      }),
    );
    return;
  }

  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    void (async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      response.once('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
});

httpServer.listen(port, host, () => {
  console.log(`Approval test MCP listening at http://${host}:${port}/mcp`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
