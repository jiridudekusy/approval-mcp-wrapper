import type { ClientTokenId, UpstreamId } from '@approval-mcp/contracts';
import type { McpTool } from '@approval-mcp/upstream';

import { publicToolName } from './tool-name.js';

export interface CatalogSourceTool {
  upstreamId: UpstreamId;
  upstreamAlias: string;
  tool: McpTool;
}

export interface PublicTool extends McpTool {
  name: string;
  upstreamId: UpstreamId;
  upstreamToolName: string;
}

export type TokenVisibility = ReadonlyMap<
  ClientTokenId,
  ReadonlySet<string>
>;

export function withPolicyDescription(
  tool: McpTool,
  policy: {
    approvalMayBeRequired: boolean;
    approvalTimeoutSeconds: number;
    toolCallTimeoutSeconds: number;
  },
): McpTool {
  const approval = policy.approvalMayBeRequired
    ? `human approval may be required (approval wait limit ${policy.approvalTimeoutSeconds} seconds)`
    : `human approval is not normally required (configured approval wait limit ${policy.approvalTimeoutSeconds} seconds)`;
  const notice = `Approval MCP: ${approval}; tool execution limit ${policy.toolCallTimeoutSeconds} seconds. Call approval_mcp__inspect_tool with the intended arguments for the exact current decision.`;
  return {
    ...tool,
    description: tool.description?.trim()
      ? `${tool.description.trim()}\n\n${notice}`
      : notice,
  };
}

export function buildTokenCatalog(
  tokenId: ClientTokenId,
  sourceTools: readonly CatalogSourceTool[],
  visibility: TokenVisibility,
): readonly PublicTool[] {
  const visible = visibility.get(tokenId) ?? new Set<string>();
  const names = new Set<string>();
  const catalog: PublicTool[] = [];
  for (const source of sourceTools) {
    const name = publicToolName(source.upstreamAlias, source.tool.name);
    if (names.has(name)) throw new Error(`Duplicate public tool name: ${name}`);
    names.add(name);
    if (!visible.has(name)) continue;
    catalog.push({
      ...source.tool,
      name,
      upstreamId: source.upstreamId,
      upstreamToolName: source.tool.name,
    });
  }
  return catalog.sort((left, right) => left.name.localeCompare(right.name));
}
