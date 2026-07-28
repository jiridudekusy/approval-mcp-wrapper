const ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

export function assertValidUpstreamAlias(alias: string): void {
  if (!ALIAS_PATTERN.test(alias) || alias.includes('__')) {
    throw new Error(
      'Upstream alias must be lowercase, unambiguous, and contain only letters, digits, hyphens, or underscores',
    );
  }
}

export function publicToolName(alias: string, toolName: string): string {
  assertValidUpstreamAlias(alias);
  if (toolName.length === 0 || toolName.includes('\0')) {
    throw new Error('Upstream tool name is invalid');
  }
  return `${alias}__${toolName}`;
}
