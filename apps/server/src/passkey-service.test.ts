import { describe, expect, it } from 'vitest';

import { ChallengeStore } from './passkey-service.js';

describe('ChallengeStore', () => {
  it('binds a short-lived challenge to purpose and consumes it once', () => {
    let now = 1_000;
    const store = new ChallengeStore(() => now);
    store.put('challenge-1', 'bootstrap', 2_000);

    expect(store.consume('challenge-1', 'login')).toBe(false);
    expect(store.consume('challenge-1', 'bootstrap')).toBe(true);
    expect(store.consume('challenge-1', 'bootstrap')).toBe(false);

    store.put('challenge-2', 'login', 1_000);
    now = 2_001;
    expect(store.consume('challenge-2', 'login')).toBe(false);
  });
});
