export interface ApprovalSseEvent {
  id: string;
  data: {
    approvalId: string;
    status: string;
    [key: string]: unknown;
  };
}

export interface ApprovalSubscription {
  close(): void;
}

export class ApprovalEventBroker {
  readonly #events: ApprovalSseEvent[] = [];
  readonly #subscribers = new Set<(event: ApprovalSseEvent) => void>();
  #sequence = 0;

  constructor(readonly replayLimit = 1_000) {}

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  publish(data: ApprovalSseEvent['data']): ApprovalSseEvent {
    const event = { id: String(++this.#sequence), data: structuredClone(data) };
    this.#events.push(event);
    if (this.#events.length > this.replayLimit) this.#events.shift();
    for (const subscriber of this.#subscribers) subscriber(structuredClone(event));
    return event;
  }

  subscribe(
    lastEventId: string | undefined,
    listener: (event: ApprovalSseEvent) => void,
  ): ApprovalSubscription {
    const last = Number(lastEventId ?? 0);
    for (const event of this.#events) {
      if (Number(event.id) > last) listener(structuredClone(event));
    }
    this.#subscribers.add(listener);
    return {
      close: () => this.#subscribers.delete(listener),
    };
  }
}
