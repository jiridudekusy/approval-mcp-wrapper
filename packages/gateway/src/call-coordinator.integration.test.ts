import type { CallEvent } from '@approval-mcp/call-journal';
import type {
  ClientTokenId,
  Policy,
  PolicyId,
  UpstreamId,
} from '@approval-mcp/contracts';
import { describe, expect, it, vi } from 'vitest';

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
      grants: () => [],
      approvals: { request: vi.fn() },
      upstream,
      journal: { append: async (event) => void events.push(event) },
    });

    await coordinator.call(
      {
        clientTokenId: policy.clientTokenId,
        upstreamId: policy.upstreamId,
        toolName: policy.toolName,
        arguments: { message: 'hello', authorization: 'secret' },
      },
      new AbortController().signal,
    );

    expect(upstream.call).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual([
      'call.received',
      'policy.decided',
      'upstream.started',
      'call.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });
});
