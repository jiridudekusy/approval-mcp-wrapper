import { describe, expect, it } from 'vitest';

import { createEmptyConfigState } from '@approval-mcp/state-store';

import { entityDisplayNames } from './entity-display-names.js';

describe('entityDisplayNames', () => {
  it('returns human-readable names without falling back to internal IDs', () => {
    const state = createEmptyConfigState();
    state.clientTokens['token-1'] = {
      id: 'token-1',
      label: 'Claude Code',
    };
    state.upstreams['upstream-1'] = {
      id: 'upstream-1',
      alias: 'Signal',
    };

    expect(entityDisplayNames(state, 'token-1', 'upstream-1')).toEqual({
      tokenLabel: 'Claude Code',
      upstreamAlias: 'Signal',
    });
    expect(entityDisplayNames(state, 'missing-token', 'missing-upstream'))
      .toEqual({});
  });
});
