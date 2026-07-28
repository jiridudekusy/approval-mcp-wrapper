import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createEmptyConfigState, reduceState } from './state-schema.js';

describe('state reduction', () => {
  it('does not mutate the previously acknowledged state', () => {
    const previous = createEmptyConfigState();
    const next = reduceState(previous, {
      type: 'record.upserted',
      collection: 'settings',
      id: 'retention',
      value: { days: 90 },
    });

    expect(previous.settings).toEqual({});
    expect(next.settings).toEqual({ retention: { days: 90 } });
  });

  it('matches a reference settings map for generated event sequences', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              type: fc.constant('record.upserted' as const),
              collection: fc.constant('settings' as const),
              id: fc.string({ minLength: 1, maxLength: 12 }),
              value: fc.record({ enabled: fc.boolean() }),
            }),
            fc.record({
              type: fc.constant('record.deleted' as const),
              collection: fc.constant('settings' as const),
              id: fc.string({ minLength: 1, maxLength: 12 }),
            }),
          ),
          { maxLength: 50 },
        ),
        (events) => {
          let state = createEmptyConfigState();
          const reference: Record<string, { enabled: boolean }> = {};

          for (const event of events) {
            state = reduceState(state, event);
            if (event.type === 'record.upserted') {
              reference[event.id] = event.value;
            } else {
              delete reference[event.id];
            }
          }

          expect(state.settings).toEqual(reference);
        },
      ),
      { numRuns: 100 },
    );
  });
});
