import { describe, expect, it, vi } from 'vitest';

import {
  MINUTES_TOOL_NAMES,
  MinutesApprovalPlugin,
} from './minutes-plugin.js';

describe('MinutesApprovalPlugin', () => {
  it('covers every current Minutes tool with a localized title', async () => {
    const plugin = new MinutesApprovalPlugin();
    for (const toolName of MINUTES_TOOL_NAMES) {
      const result = await plugin.describe({
        upstreamId: 'minutes-id',
        upstreamAlias: 'minutes',
        toolName,
        arguments: {},
      });
      expect(result.title.fallback.en).not.toContain(toolName);
      expect(result.title.fallback.cs).toBeTruthy();
    }
  });

  it('shows the complete message text and resolves its conversation', async () => {
    const readJson = vi.fn().mockResolvedValue({
      id: 'family-id',
      title: 'Rodina',
    });
    const plugin = new MinutesApprovalPlugin({ readJson });

    const result = await plugin.describe({
      upstreamId: 'minutes-id',
      upstreamAlias: 'minutes',
      toolName: 'send_message',
      arguments: {
        conversationId: 'family-id',
        text: 'Celý text zprávy',
      },
    });

    expect(readJson).toHaveBeenCalledWith(
      'minutes-id',
      'minutes://conversations/family-id',
    );
    expect(result.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ value: 'Celý text zprávy' }),
            expect.objectContaining({
              value: { id: 'family-id', name: 'Rodina' },
            }),
          ]),
        }),
      ]),
    );
    expect(result.proposedScopes).toContainEqual(
      expect.objectContaining({
        id: 'conversation',
        predicates: [
          { path: '/conversationId', operator: 'equals', value: 'family-id' },
        ],
      }),
    );
  });

  it('shows the referenced message and conversation, with a conversation-scoped grant', async () => {
    const readMessage = vi.fn().mockResolvedValue({
      content: [{ text: JSON.stringify({ message: {
        id: 'message-1', conversationId: 'family-id', text: 'Přijdu v šest.',
      } }) }],
    });
    const readJson = vi.fn().mockResolvedValue({ id: 'family-id', title: 'Rodina' });
    const plugin = new MinutesApprovalPlugin({ readJson, readMessage });
    const result = await plugin.describe({
      upstreamId: 'minutes-id',
      upstreamAlias: 'minutes',
      toolName: 'set_message_reaction',
      arguments: { messageId: 'message-1', emoji: '👍' },
    });

    expect(readMessage).toHaveBeenCalledWith('minutes-id', 'message-1');
    expect(readJson).toHaveBeenCalledWith('minutes-id', 'minutes://conversations/family-id');
    expect(result.sections[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: { id: 'family-id', name: 'Rodina' } }),
      expect.objectContaining({ value: 'Přijdu v šest.' }),
      expect.objectContaining({ value: 'message-1' }),
    ]));
    expect(result.normalizedContext['conversationId']).toBe('family-id');
    expect(result.proposedScopes).toEqual([
      expect.objectContaining({
        id: 'conversation',
        predicates: [{ path: '/conversationId', operator: 'equals', value: 'family-id' }],
      }),
    ]);
  });

  it('does not offer a message-ID grant when its conversation cannot be resolved', async () => {
    const plugin = new MinutesApprovalPlugin({
      readJson: vi.fn(),
      readMessage: vi.fn().mockRejectedValue(new Error('Unavailable')),
    });
    const result = await plugin.describe({
      upstreamId: 'minutes-id',
      upstreamAlias: 'minutes',
      toolName: 'set_message_reaction',
      arguments: { messageId: 'message-1', emoji: '👍' },
    });

    expect(result.proposedScopes).toEqual([]);
    expect(result.sections[0]?.fields).toContainEqual(expect.objectContaining({ value: 'message-1' }));
  });

  it('does not trust a caller-supplied conversation for a different message', async () => {
    const plugin = new MinutesApprovalPlugin({
      readJson: vi.fn().mockResolvedValue({ id: 'real-chat', title: 'Skutečný chat' }),
      readMessage: vi.fn().mockResolvedValue({
        structuredContent: { id: 'message-1', conversationId: 'real-chat', text: 'Ahoj' },
      }),
    });
    const result = await plugin.describe({
      upstreamId: 'minutes-id', upstreamAlias: 'minutes', toolName: 'set_message_reaction',
      arguments: { messageId: 'message-1', conversationId: 'forged-chat', emoji: '👍' },
    });

    expect(result.normalizedContext['conversationId']).toBe('real-chat');
    expect(result.proposedScopes[0]?.predicates).toEqual([
      { path: '/conversationId', operator: 'equals', value: 'real-chat' },
    ]);
  });

  it('does not offer a reusable scope for leaving a group', async () => {
    const plugin = new MinutesApprovalPlugin();
    const result = await plugin.describe({
      upstreamId: 'minutes-id',
      upstreamAlias: 'minutes',
      toolName: 'leave_group',
      arguments: { groupId: 'family-id' },
    });

    expect(result.sections[0]?.risk).toBe('danger');
    expect(result.proposedScopes).toEqual([]);
  });

  it('marks group termination as dangerous and never offers a reusable scope', async () => {
    const result = await new MinutesApprovalPlugin().describe({
      upstreamId: 'minutes-id',
      upstreamAlias: 'minutes',
      toolName: 'terminate_group',
      arguments: { groupId: 'family-id' },
    });

    expect(result.sections[0]?.risk).toBe('danger');
    expect(result.proposedScopes).toEqual([]);
  });
});
