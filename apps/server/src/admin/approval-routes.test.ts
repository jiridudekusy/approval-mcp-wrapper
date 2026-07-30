import { describe, expect, it, vi } from 'vitest';

import { openSseResponse } from './approval-routes.js';

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
