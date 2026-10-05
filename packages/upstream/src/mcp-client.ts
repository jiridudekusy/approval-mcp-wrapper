import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { LookupAddress } from 'node:dns';

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import {
  DefaultAddressPolicy,
  type AddressPolicy,
  type NetworkRules,
  type ResolvedAddress,
} from './address-policy.js';
import type { UpstreamCredentials } from './credential-envelope.js';

export interface McpConnection {
  listTools(): Promise<{ tools: readonly McpTool[] }>;
  callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
  }, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<unknown>;
  readResource(
    input: { uri: string },
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpTool {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | undefined;
  annotations?: Record<string, unknown> | undefined;
}

export interface McpConnectInput {
  url: URL;
  allowPrivateNetwork: boolean;
  credentials?: UpstreamCredentials;
}

export interface McpConnectionFactory {
  connect(input: McpConnectInput): Promise<McpConnection>;
}

export type ResolveHost = (hostname: string) => Promise<readonly ResolvedAddress[]>;

function bodyBuffer(body: BodyInit | null | undefined): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new Error('Unsupported MCP request body type');
}

function responseHeaders(
  headers: http.IncomingHttpHeaders,
): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

interface PinnedFetchOptions {
  addressPolicy: AddressPolicy;
  resolveHost: ResolveHost;
  rules: NetworkRules;
  maxRedirects?: number;
  maxResponseBytes?: number;
}

export function createPinnedFetch(options: PinnedFetchOptions): typeof fetch {
  const request = async (
    input: URL | RequestInfo,
    init?: RequestInit,
    redirectCount = 0,
  ): Promise<Response> => {
    const sourceRequest = input instanceof Request ? input : undefined;
    const url = new URL(
      input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url,
    );
    const resolved = await options.resolveHost(url.hostname);
    options.addressPolicy.assertAllowed(url, resolved, options.rules);
    const pinned = resolved[0];
    if (pinned === undefined) throw new Error('Hostname did not resolve');

    const headers = new Headers(sourceRequest?.headers);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const method = init?.method ?? sourceRequest?.method ?? 'GET';
    const body = bodyBuffer(init?.body);

    const response = await new Promise<Response>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const nodeRequest = transport.request(
        url,
        {
          method,
          headers: Object.fromEntries(headers.entries()),
          signal: init?.signal ?? undefined,
          servername: url.hostname,
          lookup(_hostname, lookupOptions, callback) {
            const family =
              typeof lookupOptions === 'object' && lookupOptions.all === true
                ? undefined
                : pinned.family;
            if (
              typeof lookupOptions === 'object' &&
              lookupOptions.all === true
            ) {
              callback(null, [
                { address: pinned.address, family: pinned.family },
              ] as LookupAddress[]);
            } else {
              callback(null, pinned.address, family ?? pinned.family);
            }
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          const maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
          let receivedBytes = 0;
          let rejected = false;
          incoming.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buffer.byteLength;
            if (receivedBytes > maxResponseBytes) {
              rejected = true;
              incoming.destroy();
              reject(
                new Error(
                  `Upstream response exceeds ${maxResponseBytes} bytes`,
                ),
              );
              return;
            }
            chunks.push(buffer);
          });
          incoming.on('end', () => {
            if (rejected) return;
            resolve(
              new Response(Buffer.concat(chunks), {
                status: incoming.statusCode ?? 500,
                headers: responseHeaders(incoming.headers),
                ...(incoming.statusMessage === undefined
                  ? {}
                  : { statusText: incoming.statusMessage }),
              }),
            );
          });
        },
      );
      nodeRequest.on('error', reject);
      if (body !== undefined) nodeRequest.write(body);
      nodeRequest.end();
    });

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has('location')
    ) {
      if (init?.redirect === 'error') throw new Error('Redirect not allowed');
      if (init?.redirect === 'manual') return response;
      const limit = options.maxRedirects ?? 5;
      if (redirectCount >= limit) throw new Error('Too many upstream redirects');
      const target = new URL(response.headers.get('location') ?? '', url);
      const targetAddresses = await options.resolveHost(target.hostname);
      options.addressPolicy.assertAllowed(target, targetAddresses, options.rules);
      if (target.origin !== url.origin) {
        throw new Error('Cross-origin upstream redirect is not allowed');
      }
      return request(target, init, redirectCount + 1);
    }
    return response;
  };
  return request as typeof fetch;
}

export class OfficialMcpConnectionFactory implements McpConnectionFactory {
  readonly #addressPolicy: AddressPolicy;
  readonly #resolveHost: ResolveHost;

  constructor(options?: {
    addressPolicy?: AddressPolicy;
    resolveHost?: ResolveHost;
  }) {
    this.#addressPolicy = options?.addressPolicy ?? new DefaultAddressPolicy();
    this.#resolveHost =
      options?.resolveHost ??
      (async (hostname) => {
        const results = await dnsLookup(hostname, { all: true, verbatim: true });
        return results.map((entry) => ({
          address: entry.address,
          family: entry.family === 6 ? 6 : 4,
        }));
      });
  }

  async connect(input: McpConnectInput): Promise<McpConnection> {
    const requestHeaders = new Headers(input.credentials?.headers);
    if (input.credentials?.authorization !== undefined) {
      requestHeaders.set('authorization', input.credentials.authorization);
    }
    const safeFetch = createPinnedFetch({
      addressPolicy: this.#addressPolicy,
      resolveHost: this.#resolveHost,
      rules: { allowPrivateNetwork: input.allowPrivateNetwork },
    });
    const transport = new StreamableHTTPClientTransport(input.url, {
      fetch: safeFetch,
      requestInit: { headers: requestHeaders },
    });
    const client = new Client(
      { name: 'approval-mcp-wrapper', version: '0.0.0' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
      },
    );
    await client.connect(transport);
    return {
      listTools: () => client.listTools(),
      callTool: (call, options) => client.callTool(call, {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      }),
      readResource: (input, options) =>
        client.readResource(input, {
          ...(options?.timeoutMs === undefined
            ? {}
            : { timeout: options.timeoutMs }),
        }),
      close: () => client.close(),
    };
  }
}
