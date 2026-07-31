import { describe, expect, it } from 'vitest';

import { selectTheme } from './theme.js';

describe('theme selection', () => {
  it('prefers a stored theme over the system preference', () => {
    expect(selectTheme('light', true)).toBe('light');
    expect(selectTheme('dark', false)).toBe('dark');
  });

  it('falls back to the system preference', () => {
    expect(selectTheme(null, true)).toBe('dark');
    expect(selectTheme(null, false)).toBe('light');
  });
});
