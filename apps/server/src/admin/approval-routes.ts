import type {
  AdminId,
  ApprovalDecision,
  ApprovalId,
} from '@approval-mcp/contracts';
import type { ApprovalOrchestrator } from '@approval-mcp/gateway';
import type { ConfigStateStore } from '@approval-mcp/state-store';
import type { FastifyInstance } from 'fastify';

import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';
import type { ApprovalEventBroker } from './sse-broker.js';

export async function registerApprovalRoutes(
  app: FastifyInstance,
  options: {
    sessions: SessionService;
    state: ConfigStateStore;
    approvals?: ApprovalOrchestrator;
    broker: ApprovalEventBroker;
  },
): Promise<void> {
  app.get('/api/admin/approvals', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    return options.state.read((state) =>
      Object.values(state.approvals).map((value) => {
        const record = value as { approval?: unknown };
        return record.approval ?? value;
      }),
    );
  });

  app.post('/api/admin/approvals/:id/decision', async (request, reply) => {
    const session = await authorizeAdmin(request, reply, options.sessions, true);
    if (session === undefined) return;
    if (options.approvals === undefined) throw new Error('Approval service unavailable');
    const { id } = request.params as { id: string };
    const body = request.body as {
      decision?: ApprovalDecision;
      requestHash?: unknown;
    };
    if (
      body.decision === undefined ||
      typeof body.requestHash !== 'string' ||
      !['deny', 'allow_once', 'allow_until', 'allow_forever'].includes(
        body.decision.action,
      )
    ) {
      reply.code(400);
      return { error: { code: 'input.invalid', message: 'Invalid approval decision', requestId: request.id } };
    }
    const approval = await options.approvals.decide(
      id as ApprovalId,
      body.decision,
      session.adminId as AdminId,
      body.requestHash,
    );
    options.broker.publish({
      approvalId: approval.id,
      status: approval.status,
    });
    return approval;
  });

  app.get('/api/admin/approvals/events', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    const write = (event: { id: string; data: unknown }) => {
      response.write(`id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    const lastEventId =
      typeof request.headers['last-event-id'] === 'string'
        ? request.headers['last-event-id']
        : undefined;
    const subscription = options.broker.subscribe(lastEventId, write);
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
    heartbeat.unref();
    request.raw.once('close', () => {
      clearInterval(heartbeat);
      subscription.close();
    });
  });
}
