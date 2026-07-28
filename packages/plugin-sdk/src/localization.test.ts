import { describe, expect, it } from 'vitest';

import { resolveLocalizedMessage } from './contracts.js';

describe('resolveLocalizedMessage', () => {
  const message = {
    key: 'approval.title',
    params: { tool: 'send_message' },
    fallback: {
      en: 'Approve {tool}',
      cs: 'Schválit {tool}',
    },
  };

  it('resolves Czech text when present', () => {
    expect(resolveLocalizedMessage(message, 'cs')).toBe('Schválit send_message');
  });

  it('falls back to English when Czech text is absent', () => {
    expect(
      resolveLocalizedMessage(
        { ...message, fallback: { en: 'Approve {tool}' } },
        'cs',
      ),
    ).toBe('Approve send_message');
  });
});
