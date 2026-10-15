import { describe, expect, it } from 'vitest';

import { formatIsoDateTime } from './date-time.js';

describe('human date and time formatting', () => {
  it('shows timezone-free MCP times without shifting their wall time', () => {
    expect(formatIsoDateTime('2026-10-17T20:00', 'cs')).toBe('17. 10. 2026 v 20:00');
    expect(formatIsoDateTime('2026-10-17T20:00:00', 'en')).toBe('10/17/2026 at 20:00');
  });

  it('formats date-only filters without inventing a time', () => {
    expect(formatIsoDateTime('2026-10-17', 'cs')).toBe('17. 10. 2026');
  });

  it('leaves non-dates and invalid dates untouched', () => {
    expect(formatIsoDateTime('2026-02-30T20:00', 'cs')).toBeUndefined();
    expect(formatIsoDateTime('62431', 'cs')).toBeUndefined();
  });
});
