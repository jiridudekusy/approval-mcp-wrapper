import { describe, expect, it } from 'vitest';

import { passkeyErrorMessageKey } from './login.js';

describe('passkeyErrorMessageKey', () => {
  it('keeps origin and authenticator failures actionable', () => {
    expect(passkeyErrorMessageKey({ code: 'ERROR_INVALID_RP_ID' }))
      .toBe('login.passkeyOriginFailed');
    expect(passkeyErrorMessageKey({
      code: 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT',
    })).toBe('login.passkeyAuthenticatorFailed');
  });

  it('recognizes a cancelled browser ceremony without exposing details', () => {
    const error = new Error('Browser-specific text');
    error.name = 'NotAllowedError';
    expect(passkeyErrorMessageKey(error)).toBe('login.passkeyCancelled');
  });

  it('uses the generic message for unknown failures', () => {
    expect(passkeyErrorMessageKey(new Error('network failed')))
      .toBe('login.failed');
  });
});
