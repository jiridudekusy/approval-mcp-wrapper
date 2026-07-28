import type { Grant, JsonValue } from '@approval-mcp/contracts';

import { matchesAllPredicates } from './predicate.js';

export interface GrantMatchInput {
  clientTokenId: string;
  upstreamId: string;
  toolName: string;
  context: JsonValue;
  requestHash: string;
  callId?: string;
  normalizationVersion: number;
  now: string;
}

export function grantMatches(grant: Grant, input: GrantMatchInput): boolean {
  return (
    grant.clientTokenId === input.clientTokenId &&
    grant.upstreamId === input.upstreamId &&
    grant.toolName === input.toolName &&
    grant.revokedAt === undefined &&
    (grant.expiresAt === undefined || grant.expiresAt > input.now) &&
    grant.normalizationVersion === input.normalizationVersion &&
    (grant.requestHash === undefined || grant.requestHash === input.requestHash) &&
    (grant.callId === undefined || grant.callId === input.callId) &&
    matchesAllPredicates(input.context, grant.predicates)
  );
}
