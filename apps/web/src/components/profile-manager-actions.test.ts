import { describe, expect, it } from 'vitest';

import { runProfileMutation } from './profile-manager-actions.js';
import { effectiveOutcomeCounts } from './profile-manager.js';

describe('profile manager mutations', () => {
  it('summarizes effective tools rather than raw rule records', () => {
    const counts = effectiveOutcomeCounts(
      [{ id: 'signal' }],
      { signal: { upstreamId: 'signal', refreshedAt: '2026-01-01T00:00:00Z', tools: [{ name: 'read', inputSchema: {} }, { name: 'send', inputSchema: {} }] } },
      [
        { id: 'server', profileId: 'profile', upstreamId: 'signal', outcome: 'allow' },
        { id: 'tool', profileId: 'profile', upstreamId: 'signal', toolName: 'send', outcome: 'require_approval' },
      ],
    );
    expect(counts).toEqual({ allow: 1, deny: 0, require_approval: 1 });
  });
  it('refreshes the profile list without loading rules after profile deletion', async () => {
    const events: string[] = [];

    await runProfileMutation({
      operation: async () => {
        events.push('delete');
      },
      reloadRules: undefined,
      refreshProfiles: () => {
        events.push('refresh');
      },
    });

    expect(events).toEqual(['delete', 'refresh']);
  });
});
