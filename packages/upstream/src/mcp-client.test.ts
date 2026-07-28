import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { DefaultAddressPolicy } from './address-policy.js';
import { createPinnedFetch, type ResolveHost } from './mcp-client.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
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
});
