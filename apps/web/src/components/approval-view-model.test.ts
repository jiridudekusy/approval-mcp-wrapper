import { describe, expect, it } from 'vitest';

import { approvalViewModel } from './approval-view-model.js';

describe('approvalViewModel', () => {
  it('maps pending records and excludes terminal approvals', () => {
    const record = {
      tokenLabel: 'Claude Code',
      upstreamAlias: 'Signal',
      approval: {
        id: 'a1',
        callId: 'c1',
        requestHash: 'hash',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      request: {
        clientTokenId: 'token',
        upstreamId: 'signal',
        toolName: 'send_message',
        context: { authorization: '[REDACTED]' },
        expiresAt: '2026-01-01T00:05:00.000Z',
      },
    };
    const viewModel = approvalViewModel(record);
    expect(viewModel).toMatchObject({
      id: 'a1',
      agentName: 'Claude Code',
      upstreamName: 'Signal',
      arguments: { authorization: '[REDACTED]' },
    });
    expect(viewModel).not.toHaveProperty('tokenId');
    expect(viewModel).not.toHaveProperty('upstreamId');
    expect(
      approvalViewModel({
        ...record,
        approval: { ...record.approval, status: 'denied' },
      }),
    ).toBeUndefined();
  });
});
