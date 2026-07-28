import assert from 'node:assert/strict';
import test from 'node:test';

import { missingKeys } from './verify-language.mjs';

test('reports target catalog gaps against source keys', () => {
  assert.deepEqual(missingKeys({ save: 'Save', cancel: 'Cancel' }, { save: 'Uložit' }), [
    'cancel',
  ]);
});

test('sorts missing keys for deterministic output', () => {
  assert.deepEqual(missingKeys({ zebra: 'Zebra', alpha: 'Alpha' }, {}), ['alpha', 'zebra']);
});
