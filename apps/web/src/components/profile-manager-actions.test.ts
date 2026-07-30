import { describe, expect, it } from 'vitest';

import { runProfileMutation } from './profile-manager-actions.js';

describe('profile manager mutations', () => {
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
