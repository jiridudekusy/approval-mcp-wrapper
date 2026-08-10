import type {
  AdminId,
  ApprovalId,
  ApprovalRequestInput,
  CallId,
  ClientTokenId,
  UpstreamId,
} from '@approval-mcp/contracts';
import { describe, expect, it } from 'vitest';

import {
  ApprovalConflictError,
  ApprovalOrchestrator,
  InMemoryApprovalRepository,
} from './approval-orchestrator.js';

const actor = 'admin-1' as AdminId;

function input(call = 'call-1'): ApprovalRequestInput {
  return {
    callId: call as CallId,
    clientTokenId: 'token-1' as ClientTokenId,
    upstreamId: 'upstream-1' as UpstreamId,
    toolName: 'send_message',
    requestHash: `hash-${call}`,
    context: { groupId: 'family' },
    normalizationVersion: 1,
    reasonCode: 'approval.required',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function pendingId(repository: InMemoryApprovalRepository): Promise<ApprovalId> {
  const pending = (await repository.list()).find(
    (record) => record.approval.status === 'pending',
  );
  if (pending === undefined) throw new Error('Expected a pending approval');
  return pending.approval.id;
}

describe('ApprovalOrchestrator', () => {
  it('notifies listeners immediately after persisting a pending approval', async () => {
    const repository = new InMemoryApprovalRepository();
    const statuses: string[] = [];
    const controller = new AbortController();
    const orchestrator = new ApprovalOrchestrator(
      repository,
      () => new Date(),
      () => false,
      (approval) => statuses.push(approval.status),
    );

    const waiting = orchestrator.request(input(), controller.signal);
    await pendingId(repository);

    expect(statuses).toEqual(['pending']);
    controller.abort();
    await waiting;
    expect(statuses).toEqual(['pending', 'abandoned']);
  });

  it('transitions pending to approved and creates a one-time grant', async () => {
    const repository = new InMemoryApprovalRepository();
    const orchestrator = new ApprovalOrchestrator(repository);
    const waiting = orchestrator.request(input(), new AbortController().signal);
    const id = await pendingId(repository);

    await orchestrator.decide(
      id,
      { action: 'allow_once' },
      actor,
      'hash-call-1',
    );

    await expect(waiting).resolves.toMatchObject({
      status: 'approved',
      grant: { callId: 'call-1' },
    });
  });

  it('creates a reusable grant only from a server-stored plugin scope', async () => {
    const repository = new InMemoryApprovalRepository();
    const orchestrator = new ApprovalOrchestrator(repository);
    const request = input();
    request.presentation = {
      source: 'plugin',
      pluginId: 'minutes',
      pluginVersion: '1.0.0',
      title: {
        key: 'minutes.send_message',
        fallback: { en: 'Send message', cs: 'Odeslat zprávu' },
      },
      sections: [],
      proposedScopes: [
        {
          id: 'conversation',
          label: {
            key: 'minutes.scope.conversation',
            fallback: {
              en: 'Conversation: Family',
              cs: 'Konverzace: Rodina',
            },
          },
          predicates: [
            { path: '/conversationId', operator: 'equals', value: 'family' },
          ],
          durations: ['hour', 'forever'],
        },
      ],
    };
    const waiting = orchestrator.request(
      request,
      new AbortController().signal,
    );
    const id = await pendingId(repository);

    await orchestrator.decide(
      id,
      { action: 'allow_forever', scopeId: 'conversation' },
      actor,
      request.requestHash,
    );

    await expect(waiting).resolves.toMatchObject({
      status: 'approved',
      grant: {
        predicates: [
          { path: '/conversationId', operator: 'equals', value: 'family' },
        ],
        presentation: {
          pluginId: 'minutes',
          scope: { fallback: { cs: 'Konverzace: Rodina' } },
        },
      },
    });
  });

  it('rejects a reusable grant with an unknown plugin scope', async () => {
    const repository = new InMemoryApprovalRepository();
    const orchestrator = new ApprovalOrchestrator(repository);
    const controller = new AbortController();
    const request = input();
    request.presentation = {
      source: 'plugin',
      title: { key: 'title', fallback: { en: 'Title' } },
      sections: [],
      proposedScopes: [],
    };
    const waiting = orchestrator.request(request, controller.signal);
    const id = await pendingId(repository);

    await expect(
      orchestrator.decide(
        id,
        { action: 'allow_forever', scopeId: 'invented' },
        actor,
        request.requestHash,
      ),
    ).rejects.toThrow('scope');
    controller.abort();
    await waiting;
  });

  it('supports deny and rejects every second terminal transition', async () => {
    const repository = new InMemoryApprovalRepository();
    const orchestrator = new ApprovalOrchestrator(repository);
    const waiting = orchestrator.request(input(), new AbortController().signal);
    const id = await pendingId(repository);
    await orchestrator.decide(id, { action: 'deny' }, actor, 'hash-call-1');

    await expect(waiting).resolves.toMatchObject({ status: 'denied' });
    await expect(repository.find(id)).resolves.toMatchObject({
      request: { context: {} },
    });
    expect((await repository.find(id))?.request).not.toHaveProperty(
      'presentation',
    );
    await expect(
      orchestrator.decide(id, { action: 'deny' }, actor, 'hash-call-1'),
    ).rejects.toBeInstanceOf(ApprovalConflictError);
  });

  it('abandons a pending approval before resolving an aborted request', async () => {
    const repository = new InMemoryApprovalRepository();
    const orchestrator = new ApprovalOrchestrator(repository);
    const controller = new AbortController();
    const waiting = orchestrator.request(input(), controller.signal);
    const id = await pendingId(repository);

    controller.abort();

    await expect(waiting).resolves.toMatchObject({ status: 'abandoned' });
    await expect(repository.find(id)).resolves.toMatchObject({
      approval: { status: 'abandoned' },
    });
  });

  it('rejects a changed request hash', async () => {
    const repository = new InMemoryApprovalRepository();
    const orchestrator = new ApprovalOrchestrator(repository);
    void orchestrator.request(input(), new AbortController().signal);
    const id = await pendingId(repository);

    await expect(
      orchestrator.decide(id, { action: 'allow_once' }, actor, 'changed'),
    ).rejects.toThrow('hash');
  });

  it('expires a pending request before applying a late decision', async () => {
    const repository = new InMemoryApprovalRepository();
    let current = Date.now();
    const orchestrator = new ApprovalOrchestrator(
      repository,
      () => new Date(current),
    );
    const request = input();
    request.expiresAt = new Date(current + 1_000).toISOString();
    const waiting = orchestrator.request(request, new AbortController().signal);
    const id = await pendingId(repository);
    current += 2_000;

    await orchestrator.decide(id, { action: 'allow_once' }, actor, request.requestHash);

    await expect(waiting).resolves.toMatchObject({ status: 'expired' });
  });

  it('revalidates an explicit deny at decision time', async () => {
    const repository = new InMemoryApprovalRepository();
    let denied = false;
    const orchestrator = new ApprovalOrchestrator(
      repository,
      () => new Date(),
      () => denied,
    );
    const waiting = orchestrator.request(input(), new AbortController().signal);
    const id = await pendingId(repository);
    denied = true;

    await orchestrator.decide(
      id,
      { action: 'allow_once' },
      actor,
      'hash-call-1',
    );

    await expect(waiting).resolves.toMatchObject({
      status: 'denied',
      approval: { reasonCode: 'policy.explicit_deny' },
    });
  });

  it('allows exactly one of two concurrent decisions', async () => {
    const repository = new InMemoryApprovalRepository();
    const orchestrator = new ApprovalOrchestrator(repository);
    const waiting = orchestrator.request(input(), new AbortController().signal);
    const id = await pendingId(repository);

    const results = await Promise.allSettled([
      orchestrator.decide(id, { action: 'allow_once' }, actor, 'hash-call-1'),
      orchestrator.decide(id, { action: 'deny' }, actor, 'hash-call-1'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(waiting).resolves.toHaveProperty('status');
  });

  it('interrupts persisted pending approvals on startup recovery', async () => {
    const repository = new InMemoryApprovalRepository();
    const first = new ApprovalOrchestrator(repository);
    void first.request(input(), new AbortController().signal);
    const second = new ApprovalOrchestrator(repository);

    await second.interruptAll('server.restarted');

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ approval: expect.objectContaining({ status: 'interrupted' }) }),
    ]);
  });
});
