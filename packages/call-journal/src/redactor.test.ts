import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { redact } from './redactor.js';

describe('redact', () => {
  it('redacts central keys and plugin-declared paths without mutating input', () => {
    const input = {
      authorization: 'Bearer raw',
      nested: {
        body: 'safe',
        secretValue: 'private',
      },
    };

    const result = redact(input, {
      sensitivePaths: ['/nested/secretValue'],
      payloadLimitBytes: 4_096,
    });

    expect(result.value).toEqual({
      authorization: '[REDACTED]',
      nested: {
        body: 'safe',
        secretValue: '[REDACTED]',
      },
    });
    expect(input.nested.secretValue).toBe('private');
  });

  it('stores truncation metadata and a hash when the redacted payload exceeds its limit', () => {
    const input = { body: 'abcdefghij' };
    const result = redact(input, {
      sensitivePaths: [],
      payloadLimitBytes: 8,
    });

    expect(result.truncated).toBe(true);
    expect(result.hash).toBe(createHash('sha256').update(JSON.stringify(input)).digest('hex'));
    expect(result.value).toEqual({
      truncated: true,
      originalBytes: 21,
    });
  });
});
