import type {
  ClientTokenId,
  PolicyOutcome,
  Profile,
  ProfileRule,
  TokenProfileAssignment,
  UpstreamId,
} from '@approval-mcp/contracts';

const outcomePriority: Record<PolicyOutcome, number> = {
  allow: 1,
  require_approval: 2,
  deny: 3,
};

export function resolveProfileRules(input: {
  clientTokenId: ClientTokenId;
  upstreamId: UpstreamId;
  toolName: string;
  profiles: readonly Profile[];
  rules: readonly ProfileRule[];
  assignments: readonly TokenProfileAssignment[];
}): { outcome: PolicyOutcome | 'unconfigured'; rules: ProfileRule[] } {
  const assignedIds = new Set(
    input.assignments
      .filter((value) => value.clientTokenId === input.clientTokenId)
      .map((value) => value.profileId),
  );
  const activeProfileIds =
    assignedIds.size > 0
      ? assignedIds
      : new Set(
          input.profiles
            .filter((value) => value.isDefault)
            .map((value) => value.id),
        );
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
