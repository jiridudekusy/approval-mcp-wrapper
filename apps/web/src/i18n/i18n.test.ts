import { describe, expect, it } from 'vitest';

import { selectLocale, translate } from './i18n.js';

describe('i18n', () => {
  it('prefers an explicit stored locale over browser preference', () => {
    expect(selectLocale('en', ['cs-CZ'])).toBe('en');
    expect(selectLocale(null, ['cs-CZ', 'en-US'])).toBe('cs');
    expect(selectLocale(null, ['de-DE'])).toBe('en');
  });

  it('provides equivalent English and Czech built-in messages', () => {
    expect(translate('en', 'login.passkey')).toBe('Continue with passkey');
    expect(translate('cs', 'login.passkey')).toBe(
      'Pokračovat pomocí passkey',
    );
  });
});
