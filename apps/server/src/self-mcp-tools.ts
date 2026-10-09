import type { CallFilter, CallJournal } from '@approval-mcp/call-journal';
import type { ClientTokenId, UpstreamId } from '@approval-mcp/contracts';
import type { PublicTool, ToolInspection } from '@approval-mcp/gateway';
import { parseToolInspectionInput, TOOL_INSPECTION_TOOL } from '@approval-mcp/gateway';
import type { McpTool, UpstreamRegistry } from '@approval-mcp/upstream';
import type { CallToolResult } from '@modelcontextprotocol/server';

export const SELF_UPSTREAM_ID = 'approval-mcp-self' as UpstreamId;
export const SELF_UPSTREAM_ALIAS = 'approval_mcp';
export const MANAGER_TOOL_NAMES = new Set(['get_upstream_health', 'refresh_upstream_tools']);

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', additionalProperties: false, properties, required,
});
const string = { type: 'string', minLength: 1 };

export const SELF_TOOLS: readonly McpTool[] = [
  {
    ...TOOL_INSPECTION_TOOL,
    name: 'inspect_tool',
  },
  {
    name: 'list_upstreams',
    description: 'List upstream MCP servers with tools visible to this agent. Never includes credentials or private connection URLs.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'get_tool_info',
    description: 'Get metadata and the current approval decision for a tool visible to this agent.',
    inputSchema: objectSchema({ toolName: string, arguments: { type: 'object' } }, ['toolName']),
  },
  {
    name: 'list_history',
    description: 'List this agent token’s own audited calls with filters and pagination. Other agents’ calls are never returned.',
    inputSchema: objectSchema({
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      upstreamId: string,
      toolName: string,
      finalStatus: { enum: ['abandoned', 'denied', 'error', 'interrupted', 'success', 'timeout'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      cursor: string,
    }),
  },
  {
    name: 'get_history_event',
    description: 'Get an audited call timeline belonging to this agent token. Sensitive data is redacted by the journal.',
    inputSchema: objectSchema({ callId: string }, ['callId']),
  },
  {
    name: 'get_upstream_health',
    description: 'Manager-only: report upstream connection health and last catalog refresh, without credentials.',
    inputSchema: objectSchema({ upstreamId: string }),
  },
  {
    name: 'refresh_upstream_tools',
    description: 'Manager-only: immediately rediscover tools for an upstream MCP server.',
    inputSchema: objectSchema({ upstreamId: string }, ['upstreamId']),
  },
].map((tool) => ({
  ...tool,
  annotations: {
    readOnlyHint: tool.name !== 'refresh_upstream_tools',
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: tool.name === 'refresh_upstream_tools',
  },
}));

function textResult(value: unknown): CallToolResult {
  const structuredContent = value as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent,
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256) throw new Error(`Invalid ${field}`);
  return value;
}

export interface SelfToolServices {
  journal: CallJournal;
  upstreams: UpstreamRegistry;
  configuredUpstreams(): readonly { id: UpstreamId; alias: string; displayName?: string; description?: string }[];
  catalogFor(tokenId: ClientTokenId): Promise<readonly PublicTool[]>;
  inspectTool(tokenId: ClientTokenId, toolName: string, args: Record<string, unknown>): Promise<ToolInspection | undefined>;
  canManage(tokenId: ClientTokenId): boolean;
}

export async function callSelfTool(
  services: SelfToolServices,
  tokenId: ClientTokenId,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!SELF_TOOLS.some((tool) => tool.name === toolName)) throw new Error('Unknown Approval MCP tool');
  if (MANAGER_TOOL_NAMES.has(toolName) && !services.canManage(tokenId)) throw new Error('Manager permission required');
  if (toolName === 'inspect_tool' || toolName === 'get_tool_info') {
    const input = parseToolInspectionInput(args);
    if (input === undefined) throw new Error('Invalid tool inspection input');
    const tool = (await services.catalogFor(tokenId)).find((item) => item.name === input.toolName);
    if (tool === undefined) throw new Error('Tool not found');
    const inspection = await services.inspectTool(tokenId, input.toolName, input.arguments);
    if (inspection === undefined) throw new Error('Tool not found');
    return textResult(toolName === 'inspect_tool'
      ? inspection
      : {
          ...inspection,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
        });
  }
  if (toolName === 'list_upstreams') {
    const visible = new Set((await services.catalogFor(tokenId)).map((tool) => tool.upstreamId));
    return textResult({ upstreams: services.configuredUpstreams()
      .filter((upstream) => visible.has(upstream.id))
      .map(({ id, alias, displayName, description }) => ({
        id, alias,
        ...(displayName === undefined ? {} : { displayName }),
        ...(description === undefined ? {} : { description }),
      })) });
  }
  if (toolName === 'list_history') {
    const limit = args['limit'] ?? 25;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('Invalid limit');
    const filter: CallFilter = { clientTokenId: tokenId, limit: Number(limit) };
    for (const field of ['from', 'to', 'upstreamId', 'toolName', 'finalStatus'] as const) {
      const value = args[field];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
      if ((field === 'from' || field === 'to') && !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${field}`);
      Object.assign(filter, { [field]: value });
    }
    const cursor = args['cursor'];
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2048)) throw new Error('Invalid cursor');
    return textResult(await services.journal.query(filter, cursor));
  }
  if (toolName === 'get_history_event') {
    const timeline = await services.journal.get(requiredString(args['callId'], 'callId'));
    if (timeline === undefined || timeline.events[0]?.clientTokenId !== tokenId) throw new Error('Call not found');
    return textResult(timeline);
  }
  const requested = args['upstreamId'];
  if (toolName === 'refresh_upstream_tools' && requested === undefined) throw new Error('Upstream ID required');
  const configured = services.configuredUpstreams();
  const candidates = requested === undefined
    ? configured
    : configured.filter((upstream) => upstream.id === requiredString(requested, 'upstreamId'));
  if (requested !== undefined && candidates.length === 0) throw new Error('Upstream not found');
  if (toolName === 'get_upstream_health') {
    return textResult({ upstreams: candidates.map((upstream) => ({
      id: upstream.id,
      alias: upstream.alias,
      health: services.upstreams.health(upstream.id),
      toolCount: services.upstreams.getCatalog(upstream.id)?.tools.length ?? 0,
      refreshedAt: services.upstreams.getCatalog(upstream.id)?.refreshedAt ?? null,
    })) });
  }
  const upstream = candidates[0];
  if (upstream === undefined) throw new Error('Upstream not found');
  const catalog = await services.upstreams.refresh(upstream.id);
  return textResult({ upstreamId: upstream.id, toolCount: catalog.tools.length, refreshedAt: catalog.refreshedAt });
}
