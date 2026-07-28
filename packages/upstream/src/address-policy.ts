import { isIP } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface NetworkRules {
  allowPrivateNetwork: boolean;
}

export interface AddressPolicy {
  assertAllowed(
    url: URL,
    resolved: readonly ResolvedAddress[],
    rules: NetworkRules,
  ): void;
}

export class AddressPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressPolicyError';
  }
}

const METADATA_ADDRESSES = new Set([
  '169.254.169.254',
  'fd00:ec2::254',
  'fe80::a9fe:a9fe',
]);

function ipv4Number(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return (
    ((octets[0] ?? 0) << 24) |
    ((octets[1] ?? 0) << 16) |
    ((octets[2] ?? 0) << 8) |
    (octets[3] ?? 0)
  ) >>> 0;
}

function isIpv4InCidr(address: string, network: string, bits: number): boolean {
  const value = ipv4Number(address);
  const base = ipv4Number(network);
  if (value === undefined || base === undefined) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function mappedIpv4(address: string): string | undefined {
  const normalized = address.toLowerCase();
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (dotted !== undefined) return dotted;

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (hex === null) return undefined;
  const high = Number.parseInt(hex[1] ?? '', 16);
  const low = Number.parseInt(hex[2] ?? '', 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function classify(address: string): 'metadata' | 'private' | 'public' {
  const normalized = address.toLowerCase().split('%')[0] ?? address;
  const mapped = mappedIpv4(normalized);
  if (mapped !== undefined) return classify(mapped);
  if (METADATA_ADDRESSES.has(normalized)) return 'metadata';

  if (isIP(normalized) === 4) {
    if (
      isIpv4InCidr(normalized, '10.0.0.0', 8) ||
      isIpv4InCidr(normalized, '100.64.0.0', 10) ||
      isIpv4InCidr(normalized, '127.0.0.0', 8) ||
      isIpv4InCidr(normalized, '169.254.0.0', 16) ||
      isIpv4InCidr(normalized, '172.16.0.0', 12) ||
      isIpv4InCidr(normalized, '192.168.0.0', 16) ||
      isIpv4InCidr(normalized, '0.0.0.0', 8) ||
      isIpv4InCidr(normalized, '224.0.0.0', 4)
    ) {
      return 'private';
    }
    return 'public';
  }

  if (isIP(normalized) === 6) {
    if (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff')
    ) {
      return 'private';
    }
    return 'public';
  }

  throw new AddressPolicyError(`Resolver returned invalid IP address: ${address}`);
}

export class DefaultAddressPolicy implements AddressPolicy {
  assertAllowed(
    url: URL,
    resolved: readonly ResolvedAddress[],
    rules: NetworkRules,
  ): void {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new AddressPolicyError(`Unsupported upstream protocol: ${url.protocol}`);
    }
    if (url.username !== '' || url.password !== '') {
      throw new AddressPolicyError('Upstream URLs must not contain credentials');
    }
    if (resolved.length === 0) {
      throw new AddressPolicyError('Upstream hostname did not resolve');
    }

    for (const result of resolved) {
      const kind = classify(result.address);
      if (kind === 'metadata') {
        throw new AddressPolicyError(
          `Cloud metadata address is never allowed: ${result.address}`,
        );
      }
      if (kind === 'private' && !rules.allowPrivateNetwork) {
        throw new AddressPolicyError(
          `Private or special address is not allowed: ${result.address}`,
        );
      }
    }
  }
}
