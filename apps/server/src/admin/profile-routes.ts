import { randomUUID } from 'node:crypto';

import type {
  ClientTokenId,
  JsonValue,
  Policy,
  Profile,
  ProfileId,
  ProfileRule,
  ProfileRuleId,
  TokenProfileAssignment,
  TokenProfileAssignmentId,
  UpstreamId,
} from '@approval-mcp/contracts';
import type { ConfigStateStore, StateOperation } from '@approval-mcp/state-store';
import type { FastifyInstance } from 'fastify';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';

function upsert(collection: StateOperation['collection'], id: string, value: unknown): StateOperation {
  return {
    type: 'record.upserted',
    collection,
    id,
    value: value as JsonValue,
  };
}

async function initializeProfiles(state: ConfigStateStore): Promise<void> {
  const initial = state.read((current) => ({
    empty: Object.keys(current.profiles).length === 0,
    policies: Object.values(current.policies) as unknown as Policy[],
    tokens: current.clientTokens,
  }));
  if (!initial.empty) return;
  const now = new Date().toISOString();
  const defaultProfile: Profile = {
    id: randomUUID() as ProfileId,
    name: 'Default',
    isDefault: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const operations: StateOperation[] = [
    upsert('profiles', defaultProfile.id, defaultProfile),
  ];
  const grouped = Map.groupBy(
    initial.policies,
    (policy) => policy.clientTokenId,
  );
  for (const [tokenId, policies] of grouped) {
    const token = initial.tokens[tokenId] as { label?: unknown } | undefined;
    const policiesByTarget = Map.groupBy(
      policies,
      (policy) => `${policy.upstreamId}\u0000${policy.toolName}`,
    );
    const variantsByTarget = [...policiesByTarget.values()].map(
      (candidates) =>
        [
          ...new Map(
            candidates.map((policy) => [
              JSON.stringify({
                outcome: policy.outcome,
                predicates: policy.predicates,
                enabled: policy.enabled,
              }),
              policy,
            ]),
          ).values(),
        ],
    );
    const layerCount = Math.max(
      ...variantsByTarget.map((variants) => variants.length),
    );
    const baseName = `Migrated: ${
      typeof token?.label === 'string' ? token.label : tokenId
    }`;
    for (let layer = 0; layer < layerCount; layer += 1) {
      const profile: Profile = {
        id: randomUUID() as ProfileId,
        name: layer === 0 ? baseName : `${baseName} (${layer + 1})`,
        isDefault: false,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      const assignment: TokenProfileAssignment = {
        id: randomUUID() as TokenProfileAssignmentId,
        clientTokenId: tokenId,
        profileId: profile.id,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      operations.push(
        upsert('profiles', profile.id, profile),
        upsert('tokenProfileAssignments', assignment.id, assignment),
      );
      for (const variants of variantsByTarget) {
        const policy = variants[layer];
        if (policy === undefined) continue;
        const rule: ProfileRule = {
          id: randomUUID() as ProfileRuleId,
          profileId: profile.id,
          upstreamId: policy.upstreamId,
          toolName: policy.toolName,
          outcome: policy.outcome,
          predicates: policy.predicates,
          enabled: policy.enabled,
          schemaVersion: 1,
          createdAt: policy.createdAt,
          updatedAt: policy.updatedAt,
          version: 1,
        };
        operations.push(upsert('profileRules', rule.id, rule));
      }
    }
    operations.push(
      ...policies.map((policy) => ({
        type: 'record.deleted' as const,
        collection: 'policies' as const,
        id: policy.id,
      })),
    );
  }
  await state.mutate({ type: 'records.batch', operations });
}

export async function registerProfileRoutes(
  app: FastifyInstance,
  options: { sessions: SessionService; state: ConfigStateStore },
): Promise<void> {
  await initializeProfiles(options.state);
  let writeQueue: Promise<void> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation);
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  app.get('/api/admin/profiles', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    return options.state.read((state) =>
      (Object.values(state.profiles) as unknown as Profile[])
        .map((profile) => ({
          ...profile,
          ruleCount: Object.values(state.profileRules).filter(
            (value) => (value as { profileId?: unknown }).profileId === profile.id,
          ).length,
          tokenCount: Object.values(state.tokenProfileAssignments).filter(
            (value) => (value as { profileId?: unknown }).profileId === profile.id,
          ).length,
        }))
        .sort((left, right) =>
          Number(right.isDefault) - Number(left.isDefault) ||
          left.name.localeCompare(right.name),
        ),
    );
  });

  app.post('/api/admin/profiles', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    const { name } = request.body as { name?: unknown };
    if (typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({ error: { code: 'input.invalid', message: 'Invalid profile name', requestId: request.id } });
    }
    const now = new Date().toISOString();
    const profile: Profile = {
      id: randomUUID() as ProfileId,
      name: name.trim(),
      isDefault: false,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await options.state.mutate(upsert('profiles', profile.id, profile));
    return reply.code(201).send(profile);
  });

  app.put('/api/admin/profiles/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    return serialized(async () => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: unknown; isDefault?: unknown; version?: unknown };
    const profiles = options.state.read(
      (state) => Object.values(state.profiles) as unknown as Profile[],
    );
    const current = profiles.find((profile) => profile.id === id);
    if (current === undefined) return reply.code(404).send({ error: { code: 'profile.not_found', message: 'Profile not found', requestId: request.id } });
    if (body.version !== current.version) return reply.code(409).send({ error: { code: 'state.version_conflict', message: 'The record has changed', requestId: request.id } });
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length === 0)) {
      return reply.code(400).send({ error: { code: 'input.invalid', message: 'Invalid profile name', requestId: request.id } });
    }
    const now = new Date().toISOString();
    const operations: StateOperation[] = [];
    if (body.isDefault === true) {
      for (const profile of profiles.filter((value) => value.isDefault && value.id !== id)) {
        operations.push(upsert('profiles', profile.id, {
          ...profile, isDefault: false, updatedAt: now, version: profile.version + 1,
        }));
      }
    }
    const updated: Profile = {
      ...current,
      ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}),
      ...(body.isDefault === true ? { isDefault: true } : {}),
      updatedAt: now,
      version: current.version + 1,
    };
    operations.push(upsert('profiles', id, updated));
    await options.state.mutate({ type: 'records.batch', operations });
    return updated;
    });
  });

  app.delete('/api/admin/profiles/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    return serialized(async () => {
    const { id } = request.params as { id: string };
    const body = request.body as { version?: unknown };
    const deletion = options.state.read((state) => {
      const profile = state.profiles[id] as unknown as Profile | undefined;
      const ruleIds = Object.entries(state.profileRules).filter(([, value]) => (value as { profileId?: unknown }).profileId === id).map(([key]) => key);
      const assignmentIds = Object.entries(state.tokenProfileAssignments).filter(([, value]) => (value as { profileId?: unknown }).profileId === id).map(([key]) => key);
      return profile === undefined ? undefined : { profile, ruleIds, assignmentIds };
    });
    if (deletion === undefined) return reply.code(404).send({ error: { code: 'profile.not_found', message: 'Profile not found', requestId: request.id } });
    if (deletion.profile.isDefault) return reply.code(409).send({ error: { code: 'profile.default_required', message: 'Choose another default profile first', requestId: request.id } });
    if (body.version !== deletion.profile.version) return reply.code(409).send({ error: { code: 'state.version_conflict', message: 'The record has changed', requestId: request.id } });
    await options.state.mutate({
      type: 'records.batch',
      operations: [
        ...deletion.ruleIds.map((ruleId) => ({ type: 'record.deleted' as const, collection: 'profileRules' as const, id: ruleId })),
        ...deletion.assignmentIds.map((assignmentId) => ({ type: 'record.deleted' as const, collection: 'tokenProfileAssignments' as const, id: assignmentId })),
        { type: 'record.deleted', collection: 'profiles', id },
      ],
    });
    return reply.code(204).send();
    });
  });

  app.get('/api/admin/profiles/:id/rules', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    const { id } = request.params as { id: string };
    if (options.state.read((state) => state.profiles[id]) === undefined) return reply.code(404).send({ error: { code: 'profile.not_found', message: 'Profile not found', requestId: request.id } });
    return options.state.read((state) =>
      (Object.values(state.profileRules) as unknown as ProfileRule[])
        .filter((rule) => rule.profileId === id)
        .sort((left, right) => (left.toolName ?? '').localeCompare(right.toolName ?? '')),
    );
  });

  app.put('/api/admin/profiles/:id/rules/bulk', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    return serialized(async () => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      upstreamId?: unknown;
      toolNames?: unknown;
      outcome?: unknown;
    };
    if (
      options.state.read((state) => state.profiles[id]) === undefined ||
      typeof body.upstreamId !== 'string' ||
      options.state.read((state) => state.upstreams[body.upstreamId as string]) === undefined ||
      !Array.isArray(body.toolNames) ||
      body.toolNames.length === 0 ||
      body.toolNames.length > 500 ||
      !body.toolNames.every(
        (toolName) => typeof toolName === 'string' && toolName.length > 0,
      ) ||
      !['allow', 'deny', 'require_approval', 'inherit'].includes(
        String(body.outcome),
      )
    ) {
      return reply.code(400).send({ error: { code: 'input.invalid', message: 'Invalid bulk profile rules', requestId: request.id } });
    }
    const toolNames = [...new Set(body.toolNames as string[])];
    const existing = options.state.read(
      (state) => Object.values(state.profileRules) as unknown as ProfileRule[],
    );
    const now = new Date().toISOString();
    const operations: StateOperation[] = [];
    for (const toolName of toolNames) {
      const current = existing.find(
        (rule) =>
          rule.profileId === id &&
          rule.upstreamId === body.upstreamId &&
          rule.toolName === toolName,
      );
      if (body.outcome === 'inherit') {
        if (current !== undefined) {
          operations.push({
            type: 'record.deleted',
            collection: 'profileRules',
            id: current.id,
          });
        }
        continue;
      }
      const rule: ProfileRule = {
        id: current?.id ?? randomUUID() as ProfileRuleId,
        profileId: id as ProfileId,
        upstreamId: body.upstreamId as UpstreamId,
        toolName,
        outcome: body.outcome as ProfileRule['outcome'],
        predicates: current?.predicates ?? [],
        enabled: true,
        schemaVersion: 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        version: (current?.version ?? 0) + 1,
      };
      operations.push(upsert('profileRules', rule.id, rule));
    }
    if (operations.length > 0) {
      await options.state.mutate({ type: 'records.batch', operations });
    }
    return { updated: operations.length };
    });
  });

  app.put('/api/admin/profiles/:id/rules', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    return serialized(async () => {
    const { id } = request.params as { id: string };
    const body = request.body as { upstreamId?: unknown; toolName?: unknown; outcome?: unknown };
    if (
      options.state.read((state) => state.profiles[id]) === undefined ||
      typeof body.upstreamId !== 'string' ||
      options.state.read((state) => state.upstreams[body.upstreamId as string]) === undefined ||
      (body.toolName !== undefined && (typeof body.toolName !== 'string' || body.toolName.length === 0)) ||
      !['allow', 'deny', 'require_approval'].includes(String(body.outcome))
    ) {
      return reply.code(400).send({ error: { code: 'input.invalid', message: 'Invalid profile rule', requestId: request.id } });
    }
    const existing = options.state.read((state) =>
      (Object.values(state.profileRules) as unknown as ProfileRule[]).find(
        (rule) => rule.profileId === id && rule.upstreamId === body.upstreamId && rule.toolName === body.toolName,
      ),
    );
    const now = new Date().toISOString();
    const rule: ProfileRule = {
      id: existing?.id ?? randomUUID() as ProfileRuleId,
      profileId: id as ProfileId,
      upstreamId: body.upstreamId as UpstreamId,
      ...(typeof body.toolName === 'string' ? { toolName: body.toolName } : {}),
      outcome: body.outcome as ProfileRule['outcome'],
      predicates: existing?.predicates ?? [],
      enabled: true,
      schemaVersion: 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };
    await options.state.mutate(upsert('profileRules', rule.id, rule));
    return rule;
    });
  });

  app.delete('/api/admin/profile-rules/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    const { id } = request.params as { id: string };
    if (options.state.read((state) => state.profileRules[id]) === undefined) return reply.code(404).send({ error: { code: 'profile_rule.not_found', message: 'Profile rule not found', requestId: request.id } });
    await options.state.mutate({ type: 'record.deleted', collection: 'profileRules', id });
    return reply.code(204).send();
  });

  app.put('/api/admin/tokens/:id/profiles/:profileId', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    return serialized(async () => {
      const { id, profileId } = request.params as {
        id: string;
        profileId: string;
      };
      const { assigned } = request.body as { assigned?: unknown };
      const snapshot = options.state.read((state) => ({
        tokenExists: state.clientTokens[id] !== undefined,
        profile: state.profiles[profileId] as unknown as Profile | undefined,
        matching: (Object.values(
          state.tokenProfileAssignments,
        ) as unknown as TokenProfileAssignment[]).filter(
          (value) =>
            value.clientTokenId === id && value.profileId === profileId,
        ),
      }));
      if (
        typeof assigned !== 'boolean' ||
        !snapshot.tokenExists ||
        snapshot.profile === undefined ||
        snapshot.profile.isDefault
      ) {
        return reply.code(400).send({
          error: {
            code: 'assignment.invalid',
            message: 'Invalid token profile assignment',
            requestId: request.id,
          },
        });
      }
      const operations: StateOperation[] = [];
      if (assigned && snapshot.matching.length === 0) {
        const now = new Date().toISOString();
        const assignment: TokenProfileAssignment = {
          id: randomUUID() as TokenProfileAssignmentId,
          clientTokenId: id as ClientTokenId,
          profileId: profileId as ProfileId,
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        operations.push(
          upsert('tokenProfileAssignments', assignment.id, assignment),
        );
      } else if (!assigned) {
        operations.push(
          ...snapshot.matching.map((value) => ({
            type: 'record.deleted' as const,
            collection: 'tokenProfileAssignments' as const,
            id: value.id,
          })),
        );
      }
      if (operations.length > 0) {
        await options.state.mutate({ type: 'records.batch', operations });
      }
      const profileIds = options.state.read((state) =>
        (Object.values(
          state.tokenProfileAssignments,
        ) as unknown as TokenProfileAssignment[])
          .filter((value) => value.clientTokenId === id)
          .map((value) => value.profileId),
      );
      return { profileIds };
    });
  });

  app.put('/api/admin/tokens/:id/profiles', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    return serialized(async () => {
    const { id } = request.params as { id: string };
    const body = request.body as { profileIds?: unknown };
    if (!Array.isArray(body.profileIds) || !body.profileIds.every((value) => typeof value === 'string')) {
      return reply.code(400).send({ error: { code: 'input.invalid', message: 'Invalid profile assignments', requestId: request.id } });
    }
    const profileIds = [...new Set(body.profileIds)];
    const snapshot = options.state.read((state) => ({
      tokenExists: state.clientTokens[id] !== undefined,
      validProfiles: profileIds.every((profileId) => {
        const profile = state.profiles[profileId] as unknown as Profile | undefined;
        return profile !== undefined && !profile.isDefault;
      }),
      existing: Object.values(state.tokenProfileAssignments) as unknown as TokenProfileAssignment[],
    }));
    if (!snapshot.tokenExists || !snapshot.validProfiles) return reply.code(404).send({ error: { code: 'assignment.target_not_found', message: 'Token or profile not found', requestId: request.id } });
    const current = snapshot.existing.filter((value) => value.clientTokenId === id);
    const operations: StateOperation[] = current.map((value) => ({
      type: 'record.deleted',
      collection: 'tokenProfileAssignments',
      id: value.id,
    }));
    const now = new Date().toISOString();
    for (const profileId of profileIds) {
      const assignment: TokenProfileAssignment = {
        id: randomUUID() as TokenProfileAssignmentId,
        clientTokenId: id as ClientTokenId,
        profileId: profileId as ProfileId,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      operations.push(upsert('tokenProfileAssignments', assignment.id, assignment));
    }
    if (operations.length > 0) await options.state.mutate({ type: 'records.batch', operations });
    return { profileIds };
    });
  });
}
