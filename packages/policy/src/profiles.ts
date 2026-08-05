import type {
  ClientTokenId,
  PolicyOutcome,
  Profile,
  ProfileRule,
  TokenProfileAssignment,
  UpstreamId,
} from '@approval-mcp/contracts';
import {
  DEFAULT_APPROVAL_TIMEOUT_SECONDS,
  DEFAULT_TOOL_CALL_TIMEOUT_SECONDS,
} from '@approval-mcp/contracts';

const outcomePriority: Record<PolicyOutcome, number> = {
  allow: 1,
  require_approval: 2,
  deny: 3,
};

export function resolveActiveProfiles(input: {
  clientTokenId: ClientTokenId;
  profiles: readonly Profile[];
  assignments: readonly TokenProfileAssignment[];
}): Profile[] {
  const assignedIds = new Set(
    input.assignments
      .filter((value) => value.clientTokenId === input.clientTokenId)
      .map((value) => value.profileId),
  );
  return input.profiles.filter((profile) =>
    assignedIds.size > 0 ? assignedIds.has(profile.id) : profile.isDefault,
  );
}

export function resolveToolCallTimeoutSeconds(input: {
  clientTokenId: ClientTokenId;
  profiles: readonly Profile[];
  assignments: readonly TokenProfileAssignment[];
}): number {
  const timeouts = resolveActiveProfiles(input).map((profile) =>
    Number.isInteger(profile.toolCallTimeoutSeconds) &&
    profile.toolCallTimeoutSeconds > 0
      ? profile.toolCallTimeoutSeconds
      : DEFAULT_TOOL_CALL_TIMEOUT_SECONDS,
  );
  return timeouts.length === 0
    ? DEFAULT_TOOL_CALL_TIMEOUT_SECONDS
    : Math.max(...timeouts);
}

export function resolveApprovalTimeoutSeconds(input: {
  clientTokenId: ClientTokenId;
  profiles: readonly Profile[];
  assignments: readonly TokenProfileAssignment[];
}): number {
  const timeouts = resolveActiveProfiles(input).map((profile) =>
    Number.isInteger(profile.approvalTimeoutSeconds) &&
    profile.approvalTimeoutSeconds > 0
      ? profile.approvalTimeoutSeconds
      : DEFAULT_APPROVAL_TIMEOUT_SECONDS,
  );
  return timeouts.length === 0
    ? DEFAULT_APPROVAL_TIMEOUT_SECONDS
    : Math.max(...timeouts);
}

export function resolveProfileRules(input: {
  clientTokenId: ClientTokenId;
  upstreamId: UpstreamId;
  toolName: string;
  profiles: readonly Profile[];
  rules: readonly ProfileRule[];
  assignments: readonly TokenProfileAssignment[];
}): { outcome: PolicyOutcome | 'unconfigured'; rules: ProfileRule[] } {
  const activeProfileIds = new Set(resolveActiveProfiles(input).map((profile) => profile.id));
  const selected: ProfileRule[] = [];
  for (const profileId of activeProfileIds) {
    const candidates = input.rules.filter(
      (rule) =>
        rule.enabled &&
        rule.profileId === profileId &&
        rule.upstreamId === input.upstreamId,
    );
    const toolRules = candidates.filter(
      (rule) => rule.toolName === input.toolName,
    );
    selected.push(
      ...(toolRules.length > 0
        ? toolRules
        : candidates.filter((rule) => rule.toolName === undefined)),
    );
  }
  if (selected.length === 0) {
    return { outcome: 'unconfigured', rules: [] };
  }
  return {
    outcome: selected.reduce<PolicyOutcome>(
      (current, rule) =>
        outcomePriority[rule.outcome] > outcomePriority[current]
          ? rule.outcome
          : current,
      'allow',
    ),
    rules: selected,
  };
}
