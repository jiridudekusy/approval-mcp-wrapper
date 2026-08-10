import type { CallEvent } from '@approval-mcp/call-journal';
import type {
  ClientTokenId,
  Policy,
  PolicyId,
  UpstreamId,
} from '@approval-mcp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { canonicalRequestHash } from '@approval-mcp/policy';

import { PolicyCallCoordinator } from './call-coordinator.js';
import { AtMostOnceExecutionRegistry } from './pending-call-registry.js';

describe('AtMostOnceExecutionRegistry', () => {
  it('starts one upstream invocation under a concurrent execution race', async () => {
    const registry = new AtMostOnceExecutionRegistry();
    const upstream = vi.fn(async () => 'ok');

    registry.authorize('call-1');
    const results = await Promise.allSettled([
      registry.execute('call-1', upstream),
      registry.execute('call-1', upstream),
    ]);

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('cannot execute an abandoned call after a late approval', async () => {
    const registry = new AtMostOnceExecutionRegistry();
    registry.authorize('call-2');
    registry.abandon('call-2');

    await expect(registry.execute('call-2', async () => 'late')).rejects.toThrow(
      'not authorized',
    );
  });
});

describe('PolicyCallCoordinator', () => {
  it('journals the full lifecycle and invokes the upstream once', async () => {
    const events: CallEvent[] = [];
    const upstream = {
      call: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'sent' }],
      }),
    };
    const now = new Date().toISOString();
    const policy: Policy = {
      id: 'policy-1' as PolicyId,
      clientTokenId: 'token-1' as ClientTokenId,
      upstreamId: 'upstream-1' as UpstreamId,
      toolName: 'send_message',
      outcome: 'allow',
      predicates: [],
      enabled: true,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const coordinator = new PolicyCallCoordinator({
      policies: () => [policy],
      toolCallTimeoutMs: () => 120_000,
      grants: () => [],
      approvals: { request: vi.fn() },
      upstream,
      journal: { append: async (event) => void events.push(event) },
    });

    const signal = new AbortController().signal;
    await coordinator.call(
      {
        clientTokenId: policy.clientTokenId,
        upstreamId: policy.upstreamId,
        toolName: policy.toolName,
        arguments: { message: 'hello', authorization: 'secret' },
      },
      signal,
    );

    expect(upstream.call).toHaveBeenCalledTimes(1);
    expect(upstream.call).toHaveBeenCalledWith({
      upstreamId: policy.upstreamId,
      toolName: policy.toolName,
      arguments: { message: 'hello', authorization: 'secret' },
      signal,
      timeoutMs: 120_000,
    });
    expect(events.map((event) => event.type)).toEqual([
      'call.received',
      'policy.decided',
      'upstream.started',
      'call.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('uses the per-call approval timeout when creating the approval request', async () => {
    const now = new Date('2026-08-05T12:00:00.000Z');
    const policy: Policy = {
      id: 'policy-approval' as PolicyId,
      clientTokenId: 'token-1' as ClientTokenId,
      upstreamId: 'upstream-1' as UpstreamId,
      toolName: 'long_task',
      outcome: 'require_approval',
      predicates: [],
      enabled: true,
      schemaVersion: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: 1,
    };
    const approvals = {
      request: vi.fn().mockRejectedValue(new Error('captured approval request')),
    };
    const coordinator = new PolicyCallCoordinator({
      policies: () => [policy],
      approvalTimeoutMs: () => 180_000,
      grants: () => [],
      approvals,
      upstream: { call: vi.fn() },
      journal: { append: vi.fn().mockResolvedValue(undefined) },
      now: () => now,
    });
    const signal = new AbortController().signal;

    await expect(
      coordinator.call(
        {
          clientTokenId: policy.clientTokenId,
          upstreamId: policy.upstreamId,
          toolName: policy.toolName,
          arguments: {},
        },
        signal,
      ),
    ).rejects.toThrow('captured approval request');
    expect(approvals.request).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: '2026-08-05T12:03:00.000Z',
      }),
      signal,
    );
  });

  it('uses plugin context for policy and persists the complete presentation', async () => {
    const now = new Date('2026-08-05T12:00:00.000Z');
    const policy: Policy = {
      id: 'policy-minutes' as PolicyId,
      clientTokenId: 'token-1' as ClientTokenId,
      upstreamId: 'upstream-1' as UpstreamId,
      toolName: 'send_message',
      outcome: 'require_approval',
      predicates: [
        { path: '/conversationId', operator: 'equals', value: 'family' },
      ],
      enabled: true,
      schemaVersion: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: 1,
    };
    const approvals = {
      request: vi.fn().mockRejectedValue(new Error('captured request')),
    };
    const journal = { append: vi.fn().mockResolvedValue(undefined) };
    const coordinator = new PolicyCallCoordinator({
      policies: () => [policy],
      grants: () => [],
      approvals,
      upstream: { call: vi.fn() },
      journal,
      now: () => now,
      describe: vi.fn().mockResolvedValue({
        normalizationVersion: 4,
        pluginId: 'minutes',
        pluginVersion: '1.0.0',
        description: {
          source: 'plugin',
          normalizedContext: { conversationId: 'family' },
          sensitivePaths: [],
          title: {
            key: 'minutes.send_message',
            fallback: { en: 'Send message', cs: 'Odeslat zprávu' },
          },
          sections: [
            {
              id: 'request',
              heading: {
                key: 'minutes.request',
                fallback: { en: 'Request', cs: 'Požadavek' },
              },
              fields: [
                {
                  label: {
                    key: 'minutes.text',
                    fallback: { en: 'Text', cs: 'Text' },
                  },
                  value: 'Celý text zprávy',
                },
              ],
            },
          ],
          proposedScopes: [],
        },
      }),
    });
    const call = {
      clientTokenId: policy.clientTokenId,
      upstreamId: policy.upstreamId,
      toolName: policy.toolName,
      arguments: { conversationId: 'family', text: 'Celý text zprávy' },
    };

    await expect(
      coordinator.call(call, new AbortController().signal),
    ).rejects.toThrow('captured request');

    expect(approvals.request).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { conversationId: 'family' },
        normalizationVersion: 4,
        requestHash: canonicalRequestHash({
          clientTokenId: policy.clientTokenId,
          upstreamId: policy.upstreamId,
          toolName: policy.toolName,
          arguments: call.arguments,
        }),
        presentation: expect.objectContaining({
          pluginId: 'minutes',
          sections: [
            expect.objectContaining({
              fields: [expect.objectContaining({ value: 'Celý text zprávy' })],
            }),
          ],
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(journal.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call.received',
        payload: { conversationId: 'family', text: 'Celý text zprávy' },
        presentation: expect.objectContaining({ pluginId: 'minutes' }),
      }),
    );
  });
});
