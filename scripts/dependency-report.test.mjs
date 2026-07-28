import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExactVersions } from './dependency-report.mjs';

test('rejects semver ranges in runtime dependencies', () => {
  assert.deepEqual(validateExactVersions({ fastify: '^5.10.0' }), ['fastify']);
});

test('accepts exact stable and prerelease versions', () => {
  assert.deepEqual(
    validateExactVersions({
      fastify: '5.10.0',
      package: '1.2.3-beta.1',
    }),
    [],
  );
});
