import type { ClientTokenId, UpstreamId } from '@approval-mcp/contracts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface AuthorizedToolCall {
  clientTokenId: ClientTokenId;
  upstreamId: UpstreamId;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface CallCoordinator {
  call(
    input: AuthorizedToolCall,
    signal: AbortSignal,
  ): Promise<CallToolResult>;
}
