import { once } from 'node:events';

import type { CallFilter, CallJournal } from '@approval-mcp/call-journal';
import type { ConfigStateStore } from '@approval-mcp/state-store';
import type { FastifyInstance } from 'fastify';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';
import { entityDisplayNames } from './entity-display-names.js';

function filter(query: Record<string, unknown>): CallFilter {
  const result: CallFilter = {};
  for (const key of [
    'from',
    'to',
    'clientTokenId',
    'upstreamId',
    'toolName',
    'policyOutcome',
    'approvalStatus',
    'finalStatus',
  ] as const) {
    if (typeof query[key] === 'string') {
      Object.assign(result, { [key]: query[key] });
    }
  }
  if (typeof query['limit'] === 'string') result.limit = Number(query['limit']);
  return result;
}

export async function registerHistoryRoutes(
  app: FastifyInstance,
  options: {
    sessions: SessionService;
    state: ConfigStateStore;
    journal?: CallJournal;
  },
): Promise<void> {
  app.get('/api/admin/history', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    if (options.journal === undefined) throw new Error('Call journal unavailable');
    const query = request.query as Record<string, unknown>;
    const page = await options.journal.query(
      filter(query),
      typeof query['cursor'] === 'string' ? query['cursor'] : undefined,
    );
    return options.state.read((state) => ({
      ...page,
      items: page.items.map((item) => ({
        ...item,
        ...entityDisplayNames(
          state,
          item.clientTokenId,
          item.upstreamId,
        ),
      })),
    }));
  });

  app.get('/api/admin/history/:callId', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    if (options.journal === undefined) throw new Error('Call journal unavailable');
    const { callId } = request.params as { callId: string };
    const result = await options.journal.get(callId);
    if (result === undefined) {
      reply.code(404);
      return { error: { code: 'history.not_found', message: 'Call not found', requestId: request.id } };
    }
    const first = result.events[0];
    return first === undefined
      ? result
      : options.state.read((state) => ({
          ...result,
          ...entityDisplayNames(
            state,
            first.clientTokenId,
            first.upstreamId,
          ),
        }));
  });

  app.get('/api/admin/history/export', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    if (options.journal === undefined) throw new Error('Call journal unavailable');
    const query = request.query as Record<string, unknown>;
    const format = query['format'] === 'csv' ? 'csv' : 'jsonl';
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': format === 'csv' ? 'text/csv' : 'application/x-ndjson',
      'content-disposition': `attachment; filename="approval-mcp-history.${format}"`,
    });
    for await (const chunk of options.journal.export(
      filter(query),
      format,
      (event) => options.state.read((state) =>
        entityDisplayNames(
          state,
          event.clientTokenId,
          event.upstreamId,
        ),
      ),
    )) {
      if (!reply.raw.write(chunk)) await once(reply.raw, 'drain');
    }
    reply.raw.end();
  });
}
