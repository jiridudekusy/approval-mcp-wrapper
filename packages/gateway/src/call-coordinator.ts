import { randomUUID } from 'node:crypto';

import { redact, type CallEvent } from '@approval-mcp/call-journal';
import type {
  ApprovalOutcome,
  CallId,
  ClientTokenId,
  Grant,
  JsonValue,
  Policy,
  UpstreamId,
} from '@approval-mcp/contracts';
import {
  canonicalRequestHash,
  evaluatePolicy,
} from '@approval-mcp/policy';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AtMostOnceExecutionRegistry } from './pending-call-registry.js';

export interface AuthorizedToolCall {
  clientTokenId: ClientTokenId;
  upstreamId: UpstreamId;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface CallCoordinator {
  call(
    input: AuthorizedToolCall,
    signal: AbortSignal,
  ): Promise<CallToolResult>;
}

interface CoordinatorApprovalService {
  request(
    input: {
      callId: CallId;
      clientTokenId: ClientTokenId;
      upstreamId: UpstreamId;
      toolName: string;
      requestHash: string;
      context: JsonValue;
      normalizationVersion: number;
      reasonCode: string;
      expiresAt: string;
    },
    signal: AbortSignal,
  ): Promise<ApprovalOutcome>;
}

interface CoordinatorUpstream {
  call(input: {
    upstreamId: UpstreamId;
    toolName: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
}

interface CoordinatorJournal {
  append(event: CallEvent): Promise<void>;
}

interface PolicyCallCoordinatorOptions {
  policies(): readonly Policy[];
  grants(): readonly Grant[];
  approvals: CoordinatorApprovalService;
  upstream: CoordinatorUpstream;
  journal: CoordinatorJournal;
  normalizationVersion?: number;
  approvalTimeoutMs?: number;
  sensitivePaths?: readonly string[];
  now?: () => Date;
}

export class PolicyDeniedError extends Error {
  constructor(readonly reasonCode: string) {
    super('Tool call denied');
    this.name = 'PolicyDeniedError';
  }
}

export class PolicyCallCoordinator implements CallCoordinator {
  readonly #options: PolicyCallCoordinatorOptions;
  readonly #execution = new AtMostOnceExecutionRegistry();

  constructor(options: PolicyCallCoordinatorOptions) {
    this.#options = options;
  }

  async call(
    input: AuthorizedToolCall,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    const callId = randomUUID() as CallId;
    const startedAt = this.#options.now?.() ?? new Date();
    const context = input.arguments as JsonValue;
    const requestHash = canonicalRequestHash({
      clientTokenId: input.clientTokenId,
      upstreamId: input.upstreamId,
      toolName: input.toolName,
      arguments: context,
    });
    await this.#append(input, callId, 'call.received', {
      payload: redact(input.arguments, {
        sensitivePaths: this.#options.sensitivePaths ?? [],
        payloadLimitBytes: 64 * 1024,
      }).value,
    });
    const decision = evaluatePolicy({
      visible: true,
      clientTokenId: input.clientTokenId,
      upstreamId: input.upstreamId,
      toolName: input.toolName,
      context,
      requestHash,
      normalizationVersion: this.#options.normalizationVersion ?? 1,
      policies: this.#options.policies(),
      grants: this.#options.grants(),
      now: startedAt.toISOString(),
    });
    await this.#append(input, callId, 'policy.decided', {
      policyOutcome: decision.outcome,
      reasonCode: decision.reasonCode,
    });

    if (decision.outcome === 'deny') {
      await this.#terminal(input, callId, 'denied', startedAt, decision.reasonCode);
      throw new PolicyDeniedError(decision.reasonCode);
    }

    if (decision.outcome === 'require_approval') {
      await this.#append(input, callId, 'approval.requested', {
        approvalStatus: 'pending',
        reasonCode: decision.reasonCode,
      });
      const expiresAt = new Date(
        startedAt.getTime() + (this.#options.approvalTimeoutMs ?? 5 * 60_000),
      ).toISOString();
      const outcome = await this.#options.approvals.request(
        {
          callId,
          clientTokenId: input.clientTokenId,
          upstreamId: input.upstreamId,
          toolName: input.toolName,
          requestHash,
          context,
          normalizationVersion: this.#options.normalizationVersion ?? 1,
          reasonCode: decision.reasonCode,
          expiresAt,
        },
        signal,
      );
      await this.#append(input, callId, 'approval.decided', {
        approvalStatus: outcome.status,
      });
      if (outcome.status !== 'approved') {
        const finalStatus =
          outcome.status === 'denied'
            ? 'denied'
            : outcome.status === 'abandoned'
              ? 'abandoned'
              : outcome.status === 'interrupted'
                ? 'interrupted'
                : 'timeout';
        await this.#terminal(
          input,
          callId,
          finalStatus,
          startedAt,
          outcome.approval.reasonCode,
        );
        throw new PolicyDeniedError(outcome.approval.reasonCode);
      }
    }

    this.#execution.authorize(callId);
    return this.#execution.execute(callId, async () => {
      await this.#append(input, callId, 'upstream.started');
      try {
        const result = (await this.#options.upstream.call({
          upstreamId: input.upstreamId,
          toolName: input.toolName,
          arguments: input.arguments,
        })) as CallToolResult;
        await this.#terminal(input, callId, 'success', startedAt);
        return result;
      } catch (error) {
        await this.#terminal(input, callId, 'error', startedAt, 'upstream.failed');
        throw error;
      }
    });
  }

  async #terminal(
    input: AuthorizedToolCall,
    callId: CallId,
    finalStatus: NonNullable<CallEvent['finalStatus']>,
    startedAt: Date,
    reasonCode?: string,
  ): Promise<void> {
    const type =
      finalStatus === 'abandoned'
        ? 'call.abandoned'
        : finalStatus === 'interrupted'
          ? 'call.interrupted'
          : finalStatus === 'error'
            ? 'call.failed'
            : 'call.completed';
    await this.#append(input, callId, type, {
      finalStatus,
      latencyMs: Math.max(
        0,
        (this.#options.now?.() ?? new Date()).getTime() - startedAt.getTime(),
      ),
      ...(reasonCode === undefined ? {} : { reasonCode }),
    });
  }

  async #append(
    input: AuthorizedToolCall,
    callId: CallId,
    type: CallEvent['type'],
    details: Partial<CallEvent> = {},
  ): Promise<void> {
    await this.#options.journal.append({
      eventId: randomUUID(),
      callId,
      timestamp: (this.#options.now?.() ?? new Date()).toISOString(),
      type,
      clientTokenId: input.clientTokenId,
      upstreamId: input.upstreamId,
      toolName: input.toolName,
      ...details,
    });
  }
}
