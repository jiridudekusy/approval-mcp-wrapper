import { describe, expect, it } from 'vitest';

import { approvalViewModel } from './approval-view-model.js';

describe('approvalViewModel', () => {
  it('maps pending records and excludes terminal approvals', () => {
    const record = {
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
    expect(approvalViewModel(record)).toMatchObject({
      id: 'a1',
      arguments: { authorization: '[REDACTED]' },
    });
    expect(
      approvalViewModel({
        ...record,
        approval: { ...record.approval, status: 'denied' },
      }),
    ).toBeUndefined();
  });
});
