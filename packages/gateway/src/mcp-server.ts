import type { ClientTokenId } from '@approval-mcp/contracts';
import type { McpTool } from '@approval-mcp/upstream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PublicTool } from './catalog.js';
import type { CallCoordinator } from './call-coordinator.js';
import {
  parseToolInspectionInput,
  TOOL_INSPECTION_TOOL,
  TOOL_INSPECTION_TOOL_NAME,
  toolInspectionResult,
  type ToolInspection,
} from './tool-inspection.js';

export class GatewayError extends Error {
  constructor(
    readonly code: 'invalid_origin' | 'tool_not_found',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export function validateOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): void {
  if (origin === undefined || !allowedOrigins.includes(origin)) {
    throw new GatewayError('invalid_origin', 'Origin is not allowed');
  }
}

interface TokenScopedGatewayOptions {
  coordinator: CallCoordinator;
  catalogFor(
    tokenId: ClientTokenId,
  ): readonly PublicTool[] | Promise<readonly PublicTool[]>;
  inspectTool?(
    tokenId: ClientTokenId,
    toolName: string,
    argumentsValue: Record<string, unknown>,
  ): ToolInspection | undefined | Promise<ToolInspection | undefined>;
}

export class TokenScopedGateway {
  readonly #coordinator: CallCoordinator;
  readonly #catalogFor: (
    tokenId: ClientTokenId,
  ) => readonly PublicTool[] | Promise<readonly PublicTool[]>;
  readonly #inspectTool: TokenScopedGatewayOptions['inspectTool'];

  constructor(options: TokenScopedGatewayOptions) {
    this.#coordinator = options.coordinator;
    this.#catalogFor = options.catalogFor;
    this.#inspectTool = options.inspectTool;
  }

  async listTools(tokenId: ClientTokenId): Promise<readonly McpTool[]> {
    const catalog = await this.#catalogFor(tokenId);
    if (this.#inspectTool === undefined) return catalog;
    if (catalog.some((tool) => tool.name === TOOL_INSPECTION_TOOL_NAME)) {
      throw new Error(`Public tool name is reserved: ${TOOL_INSPECTION_TOOL_NAME}`);
    }
    return [TOOL_INSPECTION_TOOL, ...catalog];
  }

  async call(
    tokenId: ClientTokenId,
    publicName: string,
    argumentsValue: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    if (
      publicName === TOOL_INSPECTION_TOOL_NAME &&
      this.#inspectTool !== undefined
    ) {
      const input = parseToolInspectionInput(argumentsValue);
      if (input === undefined) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Invalid tool inspection input' }],
        };
      }
      const inspection = await this.#inspectTool(
        tokenId,
        input.toolName,
        input.arguments,
      );
      if (inspection === undefined) {
        throw new GatewayError('tool_not_found', 'Tool not found');
      }
      return toolInspectionResult(inspection);
    }
    const tool = (await this.#catalogFor(tokenId)).find(
      (candidate) => candidate.name === publicName,
    );
    if (tool === undefined) {
      throw new GatewayError('tool_not_found', 'Tool not found');
    }
    return this.#coordinator.call(
      {
        clientTokenId: tokenId,
        upstreamId: tool.upstreamId,
        toolName: tool.upstreamToolName,
        arguments: argumentsValue,
      },
      signal,
    );
  }
}

export interface McpHttpHandlerOptions {
  allowedOrigins: readonly string[];
  authenticate(bearerToken: string): Promise<ClientTokenId | undefined>;
  gateway: TokenScopedGateway;
}

function singleHeader(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}

function bearerToken(
  value: string | readonly string[] | undefined,
): string | undefined {
  const header = singleHeader(value);
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '');
  return match?.[1];
}

export function createMcpHttpHandler(
  options: McpHttpHandlerOptions,
): (
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody?: unknown,
) => Promise<void> {
  return async (request, response, parsedBody) => {
    try {
      validateOrigin(singleHeader(request.headers.origin), options.allowedOrigins);
      const plaintext = bearerToken(request.headers.authorization);
      const tokenId =
        plaintext === undefined
          ? undefined
          : await options.authenticate(plaintext);
      if (tokenId === undefined) {
        response.writeHead(401).end();
        return;
      }

      const disconnected = new AbortController();
      request.once('aborted', () => disconnected.abort());
      const server = new Server(
        { name: 'approval-mcp-wrapper', version: '0.0.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: (await options.gateway.listTools(tokenId)).map((tool) => ({
          name: tool.name,
          ...(tool.description === undefined
            ? {}
            : { description: tool.description }),
          inputSchema: tool.inputSchema as {
            type: 'object';
            properties?: Record<string, object>;
            required?: string[];
          },
          ...(tool.outputSchema === undefined
            ? {}
            : {
                outputSchema: tool.outputSchema as {
                  type: 'object';
                  properties?: Record<string, object>;
                  required?: string[];
                },
              }),
          ...(tool.annotations === undefined
            ? {}
            : { annotations: tool.annotations }),
        })),
      }));
      server.setRequestHandler(CallToolRequestSchema, async (mcpRequest, extra) => {
        const signal = AbortSignal.any([extra.signal, disconnected.signal]);
        try {
          return await options.gateway.call(
            tokenId,
            mcpRequest.params.name,
            mcpRequest.params.arguments ?? {},
            signal,
          );
        } catch (error) {
          if (
            error instanceof GatewayError &&
            error.code === 'tool_not_found'
          ) {
            return {
              isError: true,
              content: [{ type: 'text', text: 'Tool not found' }],
            };
          }
          throw error;
        }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<
        typeof StreamableHTTPServerTransport
      >[0]);
      // The SDK declarations are not exact-optional clean.
      await server.connect(transport as Transport);
      await transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      if (error instanceof GatewayError && error.code === 'invalid_origin') {
        response.writeHead(403).end();
        return;
      }
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  };
}
