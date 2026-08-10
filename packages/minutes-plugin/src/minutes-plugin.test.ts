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
});
