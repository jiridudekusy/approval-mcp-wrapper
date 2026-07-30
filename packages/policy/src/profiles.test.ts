import type {
  ClientTokenId,
  Profile,
  ProfileRule,
  TokenProfileAssignment,
  UpstreamId,
} from '@approval-mcp/contracts';
import { describe, expect, it } from 'vitest';

import { resolveProfileRules } from './profiles.js';

const tokenId = 'token-1' as ClientTokenId;
const upstreamId = 'signal' as UpstreamId;
const versioned = {
  schemaVersion: 1,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  version: 1,
};

function profile(id: string, isDefault = false): Profile {
  return { ...versioned, id, name: id, isDefault };
}

function rule(
  id: string,
  profileId: string,
  outcome: ProfileRule['outcome'],
  toolName?: string,
): ProfileRule {
  return {
    ...versioned,
    id,
    profileId,
    upstreamId,
    ...(toolName === undefined ? {} : { toolName }),
    outcome,
    predicates: [],
    enabled: true,
  };
}

function assignment(profileId: string): TokenProfileAssignment {
  return {
    ...versioned,
    id: `assignment-${profileId}`,
    clientTokenId: tokenId,
    profileId,
  };
}

describe('profile rule resolution', () => {
  it('uses the default profile only when the token has no assignments', () => {
    expect(
      resolveProfileRules({
        clientTokenId: tokenId,
        upstreamId,
        toolName: 'send',
        profiles: [profile('default', true), profile('explicit')],
        rules: [
          rule('default-rule', 'default', 'require_approval'),
          rule('explicit-rule', 'explicit', 'allow'),
        ],
        assignments: [],
      }).outcome,
    ).toBe('require_approval');
    expect(
      resolveProfileRules({
        clientTokenId: tokenId,
        upstreamId,
        toolName: 'send',
        profiles: [profile('default', true), profile('explicit')],
        rules: [
          rule('default-rule', 'default', 'deny'),
          rule('explicit-rule', 'explicit', 'allow'),
        ],
        assignments: [assignment('explicit')],
      }).outcome,
    ).toBe('allow');
  });

  it('lets a tool override its server rule within one profile', () => {
    const result = resolveProfileRules({
      clientTokenId: tokenId,
      upstreamId,
      toolName: 'send',
      profiles: [profile('default', true)],
      rules: [
        rule('server', 'default', 'allow'),
        rule('tool', 'default', 'require_approval', 'send'),
      ],
      assignments: [],
    });

    expect(result).toEqual({
      outcome: 'require_approval',
      rules: [expect.objectContaining({ id: 'tool' })],
    });
  });

  it('combines assigned profiles with deny then approval then allow precedence', () => {
    const profiles = [
      profile('allow-profile'),
      profile('approval-profile'),
      profile('deny-profile'),
    ];
    const base = {
      clientTokenId: tokenId,
      upstreamId,
      toolName: 'send',
      profiles,
      rules: [
        rule('allow', 'allow-profile', 'allow'),
        rule('approval', 'approval-profile', 'require_approval'),
        rule('deny', 'deny-profile', 'deny'),
      ],
    };

    expect(
      resolveProfileRules({
        ...base,
        assignments: [
          assignment('allow-profile'),
          assignment('approval-profile'),
        ],
      }).outcome,
    ).toBe('require_approval');
    expect(
      resolveProfileRules({
        ...base,
        assignments: [
          assignment('allow-profile'),
          assignment('approval-profile'),
          assignment('deny-profile'),
        ],
      }).outcome,
    ).toBe('deny');
  });
});
