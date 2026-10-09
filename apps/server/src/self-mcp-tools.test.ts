import type { CallJournal } from '@approval-mcp/call-journal';
import type { ClientTokenId, UpstreamId } from '@approval-mcp/contracts';
import type { PublicTool, ToolInspection } from '@approval-mcp/gateway';
import type { UpstreamRegistry } from '@approval-mcp/upstream';
import { describe, expect, it, vi } from 'vitest';

import { callSelfTool, SELF_UPSTREAM_ID, type SelfToolServices } from './self-mcp-tools.js';

const tokenId = 'token-1' as ClientTokenId;
const otherTokenId = 'token-2' as ClientTokenId;
const upstreamId = 'upstream-1' as UpstreamId;
const tool: PublicTool = {
  name: 'mail__send_message', upstreamId, upstreamToolName: 'send_message',
  description: 'Send a message', inputSchema: { type: 'object' },
};
const inspection: ToolInspection = {
  toolName: tool.name, outcome: 'require_approval', approvalRequired: true,
  reasonCode: 'approval.required', approvalTimeoutSeconds: 120,
  toolCallTimeoutSeconds: 60,
};

function fixture(canManage = false) {
  const query = vi.fn().mockResolvedValue({ items: [], nextCursor: undefined });
  const get = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue({ upstreamId, tools: [tool], refreshedAt: '2026-10-09T00:00:00.000Z' });
  const services: SelfToolServices = {
    journal: { query, get } as unknown as CallJournal,
    upstreams: {
      refresh,
      health: vi.fn().mockReturnValue({ status: 'healthy', checkedAt: '2026-10-09T00:00:00.000Z' }),
      getCatalog: vi.fn().mockReturnValue({ tools: [tool], refreshedAt: '2026-10-09T00:00:00.000Z' }),
    } as unknown as UpstreamRegistry,
    configuredUpstreams: () => [{ id: upstreamId, alias: 'mail', displayName: 'Work mail' }],
    catalogFor: vi.fn().mockResolvedValue([{ ...tool }, {
      name: 'approval_mcp__inspect_tool', upstreamId: SELF_UPSTREAM_ID,
      upstreamToolName: 'inspect_tool', inputSchema: { type: 'object' },
    }]),
    inspectTool: vi.fn().mockResolvedValue(inspection),
    canManage: () => canManage,
  };
  return { services, query, get, refresh };
}

describe('Approval MCP self tools', () => {
  it('returns the exact approval decision for a visible tool', async () => {
    const { services } = fixture();
    const result = await callSelfTool(services, tokenId, 'inspect_tool', {
      toolName: tool.name, arguments: { recipient: 'work@example.test' },
    });
    expect(result.structuredContent).toMatchObject({
      approvalRequired: true, approvalTimeoutSeconds: 120,
    });
    expect(services.inspectTool).toHaveBeenCalledWith(tokenId, tool.name, { recipient: 'work@example.test' });
    await expect(callSelfTool(services, tokenId, 'get_tool_info', { toolName: 'hidden__secret' })).rejects.toThrow('Tool not found');
  });

  it('lists only upstreams with visible tools and omits connection details', async () => {
    const { services } = fixture();
    const result = await callSelfTool(services, tokenId, 'list_upstreams', {});
    expect(result.structuredContent).toEqual({ upstreams: [{ id: upstreamId, alias: 'mail', displayName: 'Work mail' }] });
  });

  it('forces the caller token on history searches and rejects another token’s detail', async () => {
    const { services, query, get } = fixture();
    await callSelfTool(services, tokenId, 'list_history', { limit: 10, toolName: 'send_message', clientTokenId: otherTokenId });
    expect(query).toHaveBeenCalledWith({ clientTokenId: tokenId, limit: 10, toolName: 'send_message' }, undefined);
    get.mockResolvedValue({ callId: 'other-call', events: [{ clientTokenId: otherTokenId }] });
    await expect(callSelfTool(services, tokenId, 'get_history_event', { callId: 'other-call' })).rejects.toThrow('Call not found');
    get.mockResolvedValue({ callId: 'own-call', events: [{ clientTokenId: tokenId, payload: { authorization: '[REDACTED]' } }] });
    const own = await callSelfTool(services, tokenId, 'get_history_event', { callId: 'own-call' });
    expect(own.structuredContent).toMatchObject({ callId: 'own-call' });
    await expect(callSelfTool(services, tokenId, 'list_history', { limit: 101 })).rejects.toThrow('Invalid limit');
  });

  it('requires management permission for health and refresh even when called directly', async () => {
    const ordinary = fixture();
    await expect(callSelfTool(ordinary.services, tokenId, 'refresh_upstream_tools', { upstreamId })).rejects.toThrow('Manager permission required');
    expect(ordinary.refresh).not.toHaveBeenCalled();
    const manager = fixture(true);
    const result = await callSelfTool(manager.services, tokenId, 'refresh_upstream_tools', { upstreamId });
    expect(manager.refresh).toHaveBeenCalledWith(upstreamId);
    expect(result.structuredContent).toMatchObject({ upstreamId, toolCount: 1 });
  });
});
