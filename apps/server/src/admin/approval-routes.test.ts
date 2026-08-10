import { describe, expect, it, vi } from 'vitest';

import {
  openSseResponse,
  parseApprovalDecision,
} from './approval-routes.js';

describe('approval SSE response', () => {
  it('flushes headers and sends an immediate comment', () => {
    const response = {
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
    };

    openSseResponse(response);

    expect(response.writeHead).toHaveBeenCalledWith(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    expect(response.flushHeaders).toHaveBeenCalledOnce();
    expect(response.write).toHaveBeenCalledWith(': connected\n\n');
  });
});

describe('parseApprovalDecision', () => {
  it('trims an optional human denial reason', () => {
    expect(
      parseApprovalDecision({
        action: 'deny',
        reason: '  The recipient has not consented.  ',
      }),
    ).toEqual({
      action: 'deny',
      reason: 'The recipient has not consented.',
    });
    expect(parseApprovalDecision({ action: 'deny', reason: '   ' })).toEqual({
      action: 'deny',
    });
  });

  it('rejects invalid or oversized denial reasons', () => {
    expect(parseApprovalDecision({ action: 'deny', reason: 42 })).toBeUndefined();
    expect(
      parseApprovalDecision({ action: 'deny', reason: 'x'.repeat(2_001) }),
    ).toBeUndefined();
  });
});
