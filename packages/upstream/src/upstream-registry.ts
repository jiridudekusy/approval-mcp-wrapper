import { EventEmitter } from 'node:events';

import type { Upstream, UpstreamId } from '@approval-mcp/contracts';

import type { CredentialVault } from './credential-envelope.js';
import {
  OfficialMcpConnectionFactory,
  type McpConnection,
  type McpConnectionFactory,
  type McpTool,
} from './mcp-client.js';

export interface ToolCatalog {
  upstreamId: UpstreamId;
  refreshedAt: string;
  tools: readonly McpTool[];
}

export interface UpstreamCall {
  upstreamId: UpstreamId;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export type UpstreamHealth =
  | { status: 'unknown' }
  | { status: 'healthy'; checkedAt: string }
  | { status: 'unhealthy'; checkedAt: string; error: string };

interface RegistryOptions {
  upstreams: readonly Upstream[];
  connectionFactory?: McpConnectionFactory;
  credentialVault?: CredentialVault;
  now?: () => Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown upstream error';
}

export class UpstreamRegistry extends EventEmitter {
  readonly #upstreams = new Map<UpstreamId, Upstream>();
  readonly #connections = new Map<UpstreamId, McpConnection>();
  readonly #catalogs = new Map<UpstreamId, ToolCatalog>();
  readonly #health = new Map<UpstreamId, UpstreamHealth>();
  readonly #connectionFactory: McpConnectionFactory;
  readonly #credentialVault: CredentialVault | undefined;
  readonly #now: () => Date;

  constructor(options: RegistryOptions) {
    super();
    for (const upstream of options.upstreams) {
      this.#upstreams.set(upstream.id, upstream);
    }
    this.#connectionFactory =
      options.connectionFactory ?? new OfficialMcpConnectionFactory();
    this.#credentialVault = options.credentialVault;
    this.#now = options.now ?? (() => new Date());
  }

  async refresh(upstreamId: UpstreamId): Promise<ToolCatalog> {
    const upstream = this.#requireUpstream(upstreamId);
    try {
      const previous = this.#connections.get(upstreamId);
      if (previous !== undefined) await previous.close();
      const credentials =
        upstream.credentials === undefined
          ? undefined
          : this.#requireCredentialVault().decrypt(
              upstreamId,
              upstream.credentials,
            );
      const connection = await this.#connectionFactory.connect({
        url: new URL(upstream.url),
        allowPrivateNetwork: upstream.allowPrivateNetwork,
        ...(credentials === undefined ? {} : { credentials }),
      });
      const result = await connection.listTools();
      const tools = [...result.tools].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const checkedAt = this.#now().toISOString();
      const catalog: ToolCatalog = {
        upstreamId,
        refreshedAt: checkedAt,
        tools,
      };
      this.#connections.set(upstreamId, connection);
      this.#catalogs.set(upstreamId, catalog);
      this.#health.set(upstreamId, { status: 'healthy', checkedAt });
      this.emit('catalogChanged', catalog);
      return catalog;
    } catch (error) {
      this.#health.set(upstreamId, {
        status: 'unhealthy',
        checkedAt: this.#now().toISOString(),
        error: errorMessage(error),
      });
      throw error;
    }
  }

  getCatalog(upstreamId: UpstreamId): ToolCatalog | undefined {
    return this.#catalogs.get(upstreamId);
  }

  async call(input: UpstreamCall): Promise<unknown> {
    const connection =
      this.#connections.get(input.upstreamId) ??
      (await this.#connectAndReturn(input.upstreamId));
    return connection.callTool({
      name: input.toolName,
      ...(input.arguments === undefined ? {} : { arguments: input.arguments }),
    });
  }

  health(upstreamId: UpstreamId): UpstreamHealth {
    this.#requireUpstream(upstreamId);
    return this.#health.get(upstreamId) ?? { status: 'unknown' };
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.#connections.values()].map((connection) => connection.close()),
    );
    this.#connections.clear();
  }

  async #connectAndReturn(upstreamId: UpstreamId): Promise<McpConnection> {
    await this.refresh(upstreamId);
    const connection = this.#connections.get(upstreamId);
    if (connection === undefined) throw new Error('Upstream connection missing');
    return connection;
  }

  #requireCredentialVault(): CredentialVault {
    if (this.#credentialVault === undefined) {
      throw new Error('Credential vault is required for encrypted credentials');
    }
    return this.#credentialVault;
  }

  #requireUpstream(upstreamId: UpstreamId): Upstream {
    const upstream = this.#upstreams.get(upstreamId);
    if (upstream === undefined) {
      throw new Error(`Unknown upstream: ${upstreamId}`);
    }
    return upstream;
  }
}
