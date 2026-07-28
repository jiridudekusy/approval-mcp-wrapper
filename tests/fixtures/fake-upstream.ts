import { createServer, type Server } from 'node:http';

export interface FakeUpstream {
  server: Server;
  url: URL;
  close(): Promise<void>;
}

export async function startFakeUpstream(): Promise<FakeUpstream> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        id?: number | string;
        method?: string;
      };
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result:
            message.method === 'tools/list'
              ? {
                  tools: [
                    {
                      name: 'echo',
                      description: 'Echo input',
                      inputSchema: { type: 'object' },
                    },
                  ],
                }
              : { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP server address');
  }
  return {
    server,
    url: new URL(`http://fake-upstream.internal:${address.port}/mcp`),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
