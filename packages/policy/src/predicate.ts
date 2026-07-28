import type { JsonValue, Predicate } from '@approval-mcp/contracts';

interface LookupResult {
  exists: boolean;
  value?: JsonValue;
}

function decodePointer(path: string): string[] {
  if (path === '') {
    return [];
  }
  if (!path.startsWith('/')) {
    return [];
  }
  return path
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function lookup(context: JsonValue, path: string): LookupResult {
  let current: JsonValue = context;
  for (const segment of decodePointer(path)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { exists: false };
      }
      const value = current[index];
      if (value === undefined) {
        return { exists: false };
      }
      current = value;
    } else if (current !== null && typeof current === 'object') {
      if (!Object.hasOwn(current, segment)) {
        return { exists: false };
      }
      const value = current[segment];
      if (value === undefined) {
        return { exists: false };
      }
      current = value;
    } else {
      return { exists: false };
    }
  }
  return { exists: true, value: current };
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function matchesPredicate(context: JsonValue, predicate: Predicate): boolean {
  const result = lookup(context, predicate.path);
  switch (predicate.operator) {
    case 'exists':
      return result.exists === (predicate.value ?? true);
    case 'equals':
      return result.exists && jsonEquals(result.value, predicate.value);
    case 'in':
      return (
        result.exists &&
        Array.isArray(predicate.value) &&
        predicate.value.some((candidate) => jsonEquals(result.value, candidate))
      );
    case 'startsWith':
      return (
        result.exists &&
        typeof result.value === 'string' &&
        typeof predicate.value === 'string' &&
        result.value.startsWith(predicate.value)
      );
  }
}

export function matchesAllPredicates(
  context: JsonValue,
  predicates: readonly Predicate[],
): boolean {
  return predicates.every((predicate) => matchesPredicate(context, predicate));
}
