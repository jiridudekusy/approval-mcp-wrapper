import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createConfigStateStore,
  createNodeFileOperations,
} from './config-state-store.js';

async function tempDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'approval-mcp-state-'));
}

describe('ConfigStateStore', () => {
  it('replays acknowledged events after reopening', async () => {
    const dataDir = await tempDataDir();
    const store = await createConfigStateStore(dataDir);

    await store.mutate({
      type: 'record.upserted',
      collection: 'upstreams',
      id: 'upstream-1',
      value: {
        id: 'upstream-1',
        schemaVersion: 1,
        alias: 'signal',
      },
    });
    await store.close();

    const reopened = await createConfigStateStore(dataDir);
    expect(reopened.read((state) => state.upstreams['upstream-1'])).toEqual({
      id: 'upstream-1',
      schemaVersion: 1,
      alias: 'signal',
    });
    await reopened.close();
  });

  it('does not expose a mutation when durable append fails', async () => {
    const dataDir = await tempDataDir();
    const nodeFiles = createNodeFileOperations();
    const store = await createConfigStateStore(dataDir, {
      ...nodeFiles,
      appendDurable: async () => {
        throw new Error('disk unavailable');
      },
    });

    await expect(
      store.mutate({
        type: 'record.upserted',
        collection: 'upstreams',
        id: 'upstream-1',
        value: { id: 'upstream-1', schemaVersion: 1 },
      }),
    ).rejects.toThrow('disk unavailable');
    expect(store.read((state) => state.upstreams['upstream-1'])).toBeUndefined();
  });

  it('rejects a journal sequence gap instead of silently resetting state', async () => {
    const dataDir = await tempDataDir();
    const files = createNodeFileOperations();
    await files.ensureDir(dataDir);
    await files.appendDurable(
      join(dataDir, 'state.journal.jsonl'),
      `${JSON.stringify({
        sequence: 2,
        event: {
          type: 'record.upserted',
          collection: 'settings',
          id: 'retention',
          value: { days: 90 },
        },
        checksum: 'invalid',
      })}\n`,
    );

    await expect(createConfigStateStore(dataDir)).rejects.toMatchObject({
      code: 'state.corrupt_journal',
    });
  });
});
