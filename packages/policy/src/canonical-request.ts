import { createHash } from 'node:crypto';

import type { JsonValue } from '@approval-mcp/contracts';

export interface CanonicalRequest {
  clientTokenId: string;
  upstreamId: string;
  toolName: string;
  arguments: JsonValue;
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Canonical JSON rejects non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`)
    .join(',')}}`;
}

export function canonicalRequestHash(input: CanonicalRequest): string {
  const value: JsonValue = {
    clientTokenId: input.clientTokenId,
    upstreamId: input.upstreamId,
    toolName: input.toolName,
    arguments: input.arguments,
  };
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export { canonicalize as canonicalJson };
