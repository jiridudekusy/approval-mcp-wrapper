import { describe, expect, it } from 'vitest';

import { approvalIdFromServiceWorkerMessage } from './app.js';

describe('approvalIdFromServiceWorkerMessage', () => {
  it('accepts only the notification deep-link message', () => {
    expect(approvalIdFromServiceWorkerMessage({
      type: 'approval-mcp:open-approval',
      approvalId: 'approval-1',
    })).toBe('approval-1');
    expect(approvalIdFromServiceWorkerMessage({
      type: 'other',
      approvalId: 'approval-1',
    })).toBeUndefined();
    expect(approvalIdFromServiceWorkerMessage(null)).toBeUndefined();
  });
});
