import { describe, expect, it, vi } from 'vitest';

import { ApprovalEventBroker } from './sse-broker.js';

describe('ApprovalEventBroker', () => {
  it('replays events after Last-Event-ID and cleans up subscribers', () => {
    const broker = new ApprovalEventBroker(10);
    broker.publish({ approvalId: 'a1', status: 'pending' });
    const second = broker.publish({ approvalId: 'a2', status: 'pending' });
    const listener = vi.fn();

    const subscription = broker.subscribe('1', listener);
    expect(listener).toHaveBeenCalledWith(second);
    expect(broker.subscriberCount).toBe(1);

    subscription.close();
    expect(broker.subscriberCount).toBe(0);
  });
});
