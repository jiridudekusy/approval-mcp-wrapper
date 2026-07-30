import type { Grant, JsonValue, Policy } from '@approval-mcp/contracts';

import { grantMatches } from './grants.js';
import { matchesAllPredicates } from './predicate.js';

export interface PolicyInput {
  visible: boolean;
  clientTokenId: string;
  upstreamId: string;
  toolName: string;
  context: JsonValue;
  requestHash: string;
  callId?: string;
  normalizationVersion: number;
  policies: readonly Policy[];
  grants: readonly Grant[];
  now: string;
}

export type PolicyDecision =
  | { outcome: 'allow'; reasonCode: string; policyId?: Policy['id']; grantId?: Grant['id'] }
  | { outcome: 'deny'; reasonCode: string; policyId?: Policy['id'] }
  | { outcome: 'require_approval'; reasonCode: string; policyId: Policy['id'] };

function policyMatches(policy: Policy, input: PolicyInput): boolean {
  return (
    policy.enabled &&
    policy.clientTokenId === input.clientTokenId &&
    policy.upstreamId === input.upstreamId &&
    policy.toolName === input.toolName &&
    matchesAllPredicates(input.context, policy.predicates)
  );
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const matchingPolicies = input.policies.filter((policy) => policyMatches(policy, input));
  const explicitDeny = matchingPolicies.find((policy) => policy.outcome === 'deny');
  if (explicitDeny !== undefined) {
    return {
      outcome: 'deny',
      reasonCode: 'policy.explicit_deny',
      policyId: explicitDeny.id,
    };
  }

  if (!input.visible) {
    return { outcome: 'deny', reasonCode: 'tool.hidden' };
  }

  const matchingGrant = input.grants.find((grant) =>
    grantMatches(grant, {
      clientTokenId: input.clientTokenId,
      upstreamId: input.upstreamId,
      toolName: input.toolName,
      context: input.context,
      requestHash: input.requestHash,
      ...(input.callId === undefined ? {} : { callId: input.callId }),
      normalizationVersion: input.normalizationVersion,
      now: input.now,
    }),
  );
  if (matchingGrant !== undefined) {
    return {
      outcome: 'allow',
      reasonCode: 'grant.matched',
      grantId: matchingGrant.id,
    };
  }

  const approval = matchingPolicies.find((policy) => policy.outcome === 'require_approval');
  if (approval !== undefined) {
    return {
      outcome: 'require_approval',
      reasonCode: 'approval.required',
      policyId: approval.id,
    };
  }

  const explicitAllow = matchingPolicies.find((policy) => policy.outcome === 'allow');
  if (explicitAllow !== undefined) {
    return {
      outcome: 'allow',
      reasonCode: 'policy.allowed',
      policyId: explicitAllow.id,
    };
  }

  return { outcome: 'deny', reasonCode: 'policy.implicit_deny' };
}
