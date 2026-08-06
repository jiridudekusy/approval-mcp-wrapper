import type {
  ClientTokenId,
  Grant,
  JsonValue,
  Policy,
  UpstreamId,
} from '@approval-mcp/contracts';
import type { McpTool } from '@approval-mcp/upstream';
import { canonicalRequestHash, evaluatePolicy } from '@approval-mcp/policy';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const TOOL_INSPECTION_TOOL_NAME = 'approval_mcp__inspect_tool';

export interface ToolInspection {
  toolName: string;
  outcome: 'allow' | 'deny' | 'require_approval';
  approvalRequired: boolean;
  reasonCode: string;
  approvalTimeoutSeconds: number;
  toolCallTimeoutSeconds: number;
}

export function evaluateToolInspection(input: {
  publicToolName: string;
  clientTokenId: ClientTokenId;
  upstreamId: UpstreamId;
  upstreamToolName: string;
  argumentsValue: Record<string, unknown>;
  policies: readonly Policy[];
  grants: readonly Grant[];
  approvalTimeoutSeconds: number;
  toolCallTimeoutSeconds: number;
  normalizationVersion?: number;
  now?: string;
}): ToolInspection {
  const context = input.argumentsValue as JsonValue;
  const normalizationVersion = input.normalizationVersion ?? 1;
  const requestHash = canonicalRequestHash({
    clientTokenId: input.clientTokenId,
    upstreamId: input.upstreamId,
    toolName: input.upstreamToolName,
    arguments: context,
  });
  const decision = evaluatePolicy({
    visible: true,
    clientTokenId: input.clientTokenId,
    upstreamId: input.upstreamId,
    toolName: input.upstreamToolName,
    context,
    requestHash,
    normalizationVersion,
    policies: input.policies,
    grants: input.grants,
    now: input.now ?? new Date().toISOString(),
  });
  return {
    toolName: input.publicToolName,
    outcome: decision.outcome,
    approvalRequired: decision.outcome === 'require_approval',
    reasonCode: decision.reasonCode,
    approvalTimeoutSeconds: input.approvalTimeoutSeconds,
    toolCallTimeoutSeconds: input.toolCallTimeoutSeconds,
  };
}

export const TOOL_INSPECTION_TOOL: McpTool = {
  name: TOOL_INSPECTION_TOOL_NAME,
  description:
    'Inspect the current Approval MCP policy for another tool before calling it. Returns whether the intended call requires human approval and the configured approval and execution timeouts. Include the intended arguments so grants and predicates can be evaluated accurately.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      toolName: {
        type: 'string',
        minLength: 1,
        description: 'Public MCP tool name from tools/list.',
      },
      arguments: {
        type: 'object',
        additionalProperties: true,
        description: 'Arguments intended for the inspected tool. Defaults to an empty object.',
      },
    },
    required: ['toolName'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      toolName: { type: 'string' },
      outcome: { enum: ['allow', 'deny', 'require_approval'] },
      approvalRequired: { type: 'boolean' },
      reasonCode: { type: 'string' },
      approvalTimeoutSeconds: { type: 'integer', minimum: 1 },
      toolCallTimeoutSeconds: { type: 'integer', minimum: 1 },
    },
    required: [
      'toolName',
      'outcome',
      'approvalRequired',
      'reasonCode',
      'approvalTimeoutSeconds',
      'toolCallTimeoutSeconds',
    ],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export function parseToolInspectionInput(
  value: Record<string, unknown>,
): { toolName: string; arguments: Record<string, unknown> } | undefined {
  if (typeof value['toolName'] !== 'string' || value['toolName'].length === 0) {
    return undefined;
  }
  const argumentsValue = value['arguments'];
  if (
    argumentsValue !== undefined &&
    (typeof argumentsValue !== 'object' ||
      argumentsValue === null ||
      Array.isArray(argumentsValue))
  ) {
    return undefined;
  }
  return {
    toolName: value['toolName'],
    arguments: (argumentsValue ?? {}) as Record<string, unknown>,
  };
}

export function toolInspectionResult(
  inspection: ToolInspection,
): CallToolResult {
  const summary = inspection.approvalRequired
    ? `${inspection.toolName} requires human approval. Approval timeout: ${inspection.approvalTimeoutSeconds} seconds. Tool execution timeout: ${inspection.toolCallTimeoutSeconds} seconds.`
    : `${inspection.toolName} currently resolves to ${inspection.outcome} without approval. Approval timeout if required: ${inspection.approvalTimeoutSeconds} seconds. Tool execution timeout: ${inspection.toolCallTimeoutSeconds} seconds.`;
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: { ...inspection },
  };
}
