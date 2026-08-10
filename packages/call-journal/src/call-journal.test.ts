import { access, appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createCallJournal } from './call-journal.js';
import { rebuildSegmentIndex } from './segment-index.js';
import type { CallEvent } from './call-event.js';

async function tempDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'approval-mcp-calls-'));
}

function event(overrides: Partial<CallEvent> = {}): CallEvent {
  return {
    eventId: 'event-1',
    callId: 'call-1',
    timestamp: '2026-07-28T10:00:00.000Z',
    type: 'call.received',
    clientTokenId: 'token-1',
    upstreamId: 'upstream-1',
    toolName: 'send_message',
    payload: { groupId: 'family' },
    ...overrides,
  };
}

describe('CallJournal', () => {
  it('notifies listeners only after an event is durably appended', async () => {
    const dataDir = await tempDataDir();
    const listener = vi.fn();
    const journal = await createCallJournal(dataDir, listener);
    const appended = event();

    await journal.append(appended);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(appended);
    await expect(
      readFile(join(dataDir, 'calls-2026-07-28.jsonl'), 'utf8'),
    ).resolves.toContain('"eventId":"event-1"');
    await expect(
      readFile(join(dataDir, 'calls-2026-07-28.index.jsonl'), 'utf8'),
    ).resolves.toContain('"callId":"call-1"');
  });

  it('reports and ignores an incomplete final line after a crash', async () => {
    const dataDir = await tempDataDir();
    const segment = join(dataDir, 'calls-2026-07-28.jsonl');
    await writeFile(segment, `${JSON.stringify(event())}\n{"broken"`, 'utf8');

    const journal = await createCallJournal(dataDir);

    expect(journal.recovery.truncatedLines).toBe(1);
    await expect(journal.get('call-1')).resolves.toMatchObject({
      callId: 'call-1',
      events: [{ type: 'call.received' }],
    });
  });

  it('filters calls and returns a stable cursor page', async () => {
    const dataDir = await tempDataDir();
    const journal = await createCallJournal(dataDir);
    await journal.append(event());
    await journal.append(
      event({
        eventId: 'event-2',
        callId: 'call-2',
        clientTokenId: 'token-2',
        type: 'call.completed',
        finalStatus: 'success',
      }),
    );

    const page = await journal.query({ clientTokenId: 'token-2', limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.callId).toBe('call-2');
    expect(page.nextCursor).toBeUndefined();
  });

  it('rebuilds an index from source events', async () => {
    const dataDir = await tempDataDir();
    const segment = join(dataDir, 'calls-2026-07-28.jsonl');
    const index = join(dataDir, 'calls-2026-07-28.index.jsonl');
    await appendFile(segment, `${JSON.stringify(event())}\n`, 'utf8');
    await writeFile(index, 'not valid\n', 'utf8');

    await rebuildSegmentIndex(segment, index);

    const rebuilt = await readFile(index, 'utf8');
    expect(rebuilt).toContain('"callId":"call-1"');
    expect(rebuilt).not.toContain('not valid');
  });

  it('streams filtered JSONL and CSV exports', async () => {
    const dataDir = await tempDataDir();
    const journal = await createCallJournal(dataDir);
    await journal.append(event());
    await journal.append(event({ eventId: 'event-2', callId: 'call-2', clientTokenId: 'token-2' }));

    const jsonChunks: Uint8Array[] = [];
    for await (const chunk of journal.export({ clientTokenId: 'token-2' }, 'jsonl')) {
      jsonChunks.push(chunk);
    }
    const csvChunks: Uint8Array[] = [];
    for await (const chunk of journal.export({ clientTokenId: 'token-2' }, 'csv')) {
      csvChunks.push(chunk);
    }

    expect(Buffer.concat(jsonChunks).toString('utf8')).toContain('"callId":"call-2"');
    expect(Buffer.concat(jsonChunks).toString('utf8')).not.toContain('"callId":"call-1"');
    expect(Buffer.concat(csvChunks).toString('utf8')).toContain(
      'callId,timestamp,type,clientTokenId,upstreamId,toolName',
    );

    const enrichedJsonChunks: Uint8Array[] = [];
    for await (const chunk of journal.export(
      { clientTokenId: 'token-2' },
      'jsonl',
      () => ({ tokenLabel: 'Claude Code', upstreamAlias: 'Signal' }),
    )) {
      enrichedJsonChunks.push(chunk);
    }
    const enrichedCsvChunks: Uint8Array[] = [];
    for await (const chunk of journal.export(
      { clientTokenId: 'token-2' },
      'csv',
      () => ({ tokenLabel: 'Claude Code', upstreamAlias: 'Signal' }),
    )) {
      enrichedCsvChunks.push(chunk);
    }

    expect(Buffer.concat(enrichedJsonChunks).toString('utf8')).toContain(
      '"tokenLabel":"Claude Code","upstreamAlias":"Signal"',
    );
    expect(Buffer.concat(enrichedCsvChunks).toString('utf8')).toContain(
      'clientTokenId,upstreamId,toolName,payload,presentation,tokenLabel,upstreamAlias',
    );
    expect(Buffer.concat(enrichedCsvChunks).toString('utf8')).toContain(
      '"Claude Code","Signal"',
    );
  });

  it('keeps the complete plugin text in history summaries and exports', async () => {
    const dataDir = await tempDataDir();
    const journal = await createCallJournal(dataDir);
    const fullText = 'Celý text zprávy včetně druhého řádku\na detailů.';
    await journal.append(
      event({
        payload: { conversationId: 'family', text: fullText },
        presentation: {
          source: 'plugin',
          pluginId: 'minutes',
          pluginVersion: '1.0.0',
          title: {
            key: 'minutes.send_message',
            fallback: { en: 'Send message', cs: 'Odeslat zprávu' },
          },
          sections: [
            {
              id: 'request',
              heading: {
                key: 'minutes.request',
                fallback: { en: 'Request', cs: 'Požadavek' },
              },
              fields: [
                {
                  label: {
                    key: 'minutes.text',
                    fallback: { en: 'Text', cs: 'Text' },
                  },
                  value: fullText,
                },
              ],
            },
          ],
          proposedScopes: [],
        },
      }),
    );

    await expect(journal.query({})).resolves.toMatchObject({
      items: [
        {
          presentation: {
            title: { fallback: { cs: 'Odeslat zprávu' } },
          },
        },
      ],
    });
    await expect(journal.get('call-1')).resolves.toMatchObject({
      events: [
        {
          presentation: {
            sections: [{ fields: [{ value: fullText }] }],
          },
        },
      ],
    });
    const csv: Uint8Array[] = [];
    for await (const chunk of journal.export({}, 'csv')) csv.push(chunk);
    expect(Buffer.concat(csv).toString('utf8')).toContain('Celý text zprávy');
  });

  it('deletes only closed segments older than retention', async () => {
    const dataDir = await tempDataDir();
    const journal = await createCallJournal(dataDir);
    await journal.append(
      event({
        eventId: 'old-event',
        callId: 'old-call',
        timestamp: '2025-01-01T00:00:00.000Z',
      }),
    );
    await journal.append(event());

    const result = await journal.enforceRetention(new Date('2026-07-28T12:00:00.000Z'), 90);

    expect(result.deletedFiles).toEqual([
      'calls-2025-01-01.jsonl',
      'calls-2025-01-01.index.jsonl',
    ]);
    await expect(access(join(dataDir, 'calls-2025-01-01.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(join(dataDir, 'calls-2026-07-28.jsonl'))).resolves.toBeUndefined();
  });

  it('compresses closed segments and keeps their timelines readable', async () => {
    const dataDir = await tempDataDir();
    const journal = await createCallJournal(dataDir);
    await journal.append(
      event({
        eventId: 'old-event',
        callId: 'old-call',
        timestamp: '2026-07-27T10:00:00.000Z',
      }),
    );

    await journal.compressClosedSegments(new Date('2026-07-28T12:00:00.000Z'));

    await expect(access(join(dataDir, 'calls-2026-07-27.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(join(dataDir, 'calls-2026-07-27.jsonl.gz'))).resolves.toBeUndefined();
    await expect(journal.get('old-call')).resolves.toMatchObject({
      events: [{ eventId: 'old-event' }],
    });
  });
});
