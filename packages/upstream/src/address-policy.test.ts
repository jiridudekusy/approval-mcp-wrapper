import { describe, expect, it } from 'vitest';

import {
  AddressPolicyError,
  DefaultAddressPolicy,
  type ResolvedAddress,
} from './address-policy.js';

const policy = new DefaultAddressPolicy();
const url = new URL('https://mcp.example.test/rpc');

function address(value: string): ResolvedAddress {
  return { address: value, family: value.includes(':') ? 6 : 4 };
}

describe('DefaultAddressPolicy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.1.1',
    '169.254.169.254',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
  ])('blocks non-public address %s by default', (value) => {
    expect(() =>
      policy.assertAllowed(url, [address(value)], {
        allowPrivateNetwork: false,
      }),
    ).toThrow(AddressPolicyError);
  });

  it('fails the entire resolution when any answer is blocked', () => {
    expect(() =>
      policy.assertAllowed(
        url,
        [address('203.0.113.1'), address('127.0.0.1')],
        { allowPrivateNetwork: false },
      ),
    ).toThrow('127.0.0.1');
  });

  it('allows private ranges only when explicitly enabled', () => {
    expect(() =>
      policy.assertAllowed(url, [address('10.20.30.40')], {
        allowPrivateNetwork: true,
      }),
    ).not.toThrow();
  });

  it('never allows the cloud metadata address', () => {
    expect(() =>
      policy.assertAllowed(url, [address('169.254.169.254')], {
        allowPrivateNetwork: true,
      }),
    ).toThrow('metadata');
  });

  it('rejects unsupported protocols and URLs with embedded credentials', () => {
    expect(() =>
      policy.assertAllowed(
        new URL('file:///etc/passwd'),
        [address('203.0.113.1')],
        { allowPrivateNetwork: false },
      ),
    ).toThrow('protocol');
    expect(() =>
      policy.assertAllowed(
        new URL('https://user:secret@example.test'),
        [address('203.0.113.1')],
        { allowPrivateNetwork: false },
      ),
    ).toThrow('credentials');
  });
});
