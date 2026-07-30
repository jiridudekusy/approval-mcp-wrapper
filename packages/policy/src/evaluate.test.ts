import { describe, expect, it } from 'vitest';

import type { Grant, Policy, Predicate } from '@approval-mcp/contracts';

import { canonicalRequestHash } from './canonical-request.js';
import { evaluatePolicy, type PolicyInput } from './evaluate.js';
import { matchesPredicate } from './predicate.js';

const now = '2026-07-28T12:00:00.000Z';

function policy(
  outcome: Policy['outcome'],
  predicates: Predicate[] = [],
  id = `policy-${outcome}`,
): Policy {
  return {
    id: id as Policy['id'],
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
    clientTokenId: 'token-1' as Policy['clientTokenId'],
    upstreamId: 'upstream-1' as Policy['upstreamId'],
    toolName: 'send_message',
    outcome,
    predicates,
    enabled: true,
  };
}

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: 'grant-1' as Grant['id'],
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
    clientTokenId: 'token-1' as Grant['clientTokenId'],
    upstreamId: 'upstream-1' as Grant['upstreamId'],
    toolName: 'send_message',
    predicates: [],
    normalizationVersion: 1,
    approvedBy: 'admin-1' as Grant['approvedBy'],
    ...overrides,
  };
}

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    visible: true,
    clientTokenId: 'token-1',
    upstreamId: 'upstream-1',
    toolName: 'send_message',
    context: { groupId: 'family' },
    requestHash: 'request-hash',
    normalizationVersion: 1,
    policies: [],
    grants: [],
    now,
    ...overrides,
  };
}

describe('evaluatePolicy', () => {
  it('gives explicit deny precedence over a matching grant', () => {
    const decision = evaluatePolicy(
      input({
        policies: [policy('deny')],
        grants: [grant()],
      }),
    );

    expect(decision).toMatchObject({
      outcome: 'deny',
      reasonCode: 'policy.explicit_deny',
    });
  });

  it('gives a matching grant precedence over approval', () => {
    const decision = evaluatePolicy(
      input({
        policies: [policy('require_approval')],
        grants: [grant()],
      }),
    );

    expect(decision).toMatchObject({
      outcome: 'allow',
      reasonCode: 'grant.matched',
    });
  });

  it('requires approval when its predicates match and no grant applies', () => {
    const decision = evaluatePolicy(input({ policies: [policy('require_approval')] }));

    expect(decision).toMatchObject({
      outcome: 'require_approval',
      reasonCode: 'approval.required',
    });
  });

  it('gives approval precedence over allow when profiles overlap', () => {
    const decision = evaluatePolicy(
      input({
        policies: [policy('allow'), policy('require_approval')],
      }),
    );

    expect(decision.outcome).toBe('require_approval');
  });

  it('fails closed when no rule matches', () => {
    expect(evaluatePolicy(input())).toEqual({
      outcome: 'deny',
      reasonCode: 'policy.implicit_deny',
    });
  });

  it('does not match expired or incompatible grants', () => {
    const decision = evaluatePolicy(
      input({
        policies: [policy('require_approval')],
        grants: [
          grant({ expiresAt: '2026-07-28T11:59:59.000Z' }),
          grant({ normalizationVersion: 2 }),
        ],
      }),
    );

    expect(decision.outcome).toBe('require_approval');
  });
});

describe('matchesPredicate', () => {
  it.each([
    [{ path: '/groupId', operator: 'equals', value: 'family' }, true],
    [{ path: '/groupId', operator: 'in', value: ['family', 'friends'] }, true],
    [{ path: '/groupId', operator: 'startsWith', value: 'fam' }, true],
    [{ path: '/missing', operator: 'exists', value: false }, true],
  ] satisfies [Predicate, boolean][])('evaluates %j', (predicate, expected) => {
    expect(matchesPredicate({ groupId: 'family' }, predicate)).toBe(expected);
  });
});

describe('canonicalRequestHash', () => {
  it('is invariant to object key insertion order', () => {
    const left = canonicalRequestHash({
      clientTokenId: 'token-1',
      upstreamId: 'upstream-1',
      toolName: 'send_message',
      arguments: { groupId: 'family', message: { body: 'hello', urgent: false } },
    });
    const right = canonicalRequestHash({
      clientTokenId: 'token-1',
      upstreamId: 'upstream-1',
      toolName: 'send_message',
      arguments: { message: { urgent: false, body: 'hello' }, groupId: 'family' },
    });

    expect(left).toBe(right);
  });
});
