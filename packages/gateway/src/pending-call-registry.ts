type ExecutionState =
  | 'authorized'
  | 'executing'
  | 'completed'
  | 'abandoned';

export class AtMostOnceExecutionRegistry {
  readonly #states = new Map<string, ExecutionState>();

  authorize(callId: string): void {
    if (this.#states.has(callId)) {
      throw new Error(`Call is already registered: ${callId}`);
    }
    this.#states.set(callId, 'authorized');
  }

  abandon(callId: string): void {
    const state = this.#states.get(callId);
    if (state === 'executing' || state === 'completed') {
      throw new Error(`Executing call cannot be abandoned: ${callId}`);
    }
    this.#states.set(callId, 'abandoned');
  }

  async execute<T>(callId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#states.get(callId) !== 'authorized') {
      throw new Error(`Call is not authorized for execution: ${callId}`);
    }
    // JavaScript runs this transition synchronously before another contender can
    // enter, making authorized -> executing a one-way acquisition.
    this.#states.set(callId, 'executing');
    try {
      const result = await operation();
      this.#states.set(callId, 'completed');
      return result;
    } catch (error) {
      this.#states.set(callId, 'completed');
      throw error;
    }
  }
}
