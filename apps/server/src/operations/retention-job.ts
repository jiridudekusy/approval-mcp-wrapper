import type { CallJournal } from '@approval-mcp/call-journal';

export function startRetentionJob(options: {
  journal: CallJournal;
  retentionDays: number;
  intervalMs?: number;
}): { close(): void } {
  const run = () => {
    void options.journal
      .compressClosedSegments(new Date())
      .then(() =>
        options.journal.enforceRetention(new Date(), options.retentionDays),
      );
  };
  run();
  const timer = setInterval(run, options.intervalMs ?? 24 * 60 * 60_000);
  timer.unref();
  return { close: () => clearInterval(timer) };
}
