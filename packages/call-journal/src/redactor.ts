import { createHash } from 'node:crypto';

import type { JsonValue } from '@approval-mcp/contracts';

export interface RedactionPlan {
  sensitivePaths: readonly string[];
  payloadLimitBytes: number;
}

export interface RedactionResult {
  value: JsonValue;
  truncated: boolean;
  hash?: string;
  reasonCode?: 'redaction.failed';
}

const CENTRAL_SENSITIVE_KEYS = new Set([
  'access_token',
  'api_key',
  'authorization',
  'cookie',
  'credential',
  'password',
  'refresh_token',
  'secret',
  'token',
]);

function decodePointer(path: string): string[] {
  if (path === '') {
    return [];
  }
  if (!path.startsWith('/')) {
    throw new Error(`Sensitive path must be a JSON pointer: ${path}`);
  }
  return path
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function shouldRedact(path: readonly string[], key: string, declared: readonly string[][]): boolean {
  if (CENTRAL_SENSITIVE_KEYS.has(key.toLowerCase())) {
    return true;
  }
  const fullPath = [...path, key];
  return declared.some(
    (candidate) =>
      candidate.length === fullPath.length &&
      candidate.every((part, index) => part === fullPath[index]),
  );
}

function copyAndRedact(
  input: unknown,
  path: readonly string[],
  declared: readonly string[][],
): JsonValue {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') {
    return input;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error('Non-finite numbers are not valid JSON');
    }
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((value, index) => copyAndRedact(value, [...path, String(index)], declared));
  }
  if (typeof input === 'object') {
    const output: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = shouldRedact(path, key, declared)
        ? '[REDACTED]'
        : copyAndRedact(value, [...path, key], declared);
    }
    return output;
  }
  throw new Error(`Unsupported JSON value type: ${typeof input}`);
}

export function redact(input: unknown, plan: RedactionPlan): RedactionResult {
  try {
    const originalSerialized = JSON.stringify(input);
    if (originalSerialized === undefined) {
      throw new Error('Payload cannot be serialized');
    }
    const declared = plan.sensitivePaths.map(decodePointer);
    const value = copyAndRedact(input, [], declared);
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized);

    if (bytes > plan.payloadLimitBytes) {
      return {
        value: {
          truncated: true,
          originalBytes: Buffer.byteLength(originalSerialized),
        },
        truncated: true,
        hash: createHash('sha256').update(originalSerialized).digest('hex'),
      };
    }
    return { value, truncated: false };
  } catch {
    return {
      value: { redactionFailed: true },
      truncated: false,
      reasonCode: 'redaction.failed',
    };
  }
}
