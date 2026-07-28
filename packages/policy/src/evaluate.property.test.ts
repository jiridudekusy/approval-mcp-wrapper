import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalRequestHash } from './canonical-request.js';

describe('canonicalRequestHash properties', () => {
  it('is deterministic for generated JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const request = {
          clientTokenId: 'token-1',
          upstreamId: 'upstream-1',
          toolName: 'tool',
          arguments: { value },
        };
        expect(canonicalRequestHash(request)).toBe(canonicalRequestHash(structuredClone(request)));
      }),
      { numRuns: 100 },
    );
  });
});
