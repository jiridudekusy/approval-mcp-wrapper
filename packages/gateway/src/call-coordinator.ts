import { randomUUID } from 'node:crypto';

import { redact, type CallEvent } from '@approval-mcp/call-journal';
import type {
  ApprovalOutcome,
  ApprovalRequestInput,
  CallId,
  CallPresentation,
  ClientTokenId,
  Grant,
  JsonValue,
  Policy,
  UpstreamId,
} from '@approval-mcp/contracts';
import {
  DEFAULT_APPROVAL_TIMEOUT_SECONDS,
  DEFAULT_TOOL_CALL_TIMEOUT_SECONDS,
} from '@approval-mcp/contracts';
import {
  canonicalRequestHash,
  evaluatePolicy,
} from '@approval-mcp/policy';
import type { PluginCallDescription } from '@approval-mcp/plugin-sdk';
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
    input: ApprovalRequestInput,
    signal: AbortSignal,
  ): Promise<ApprovalOutcome>;
}

interface CoordinatorUpstream {
  call(input: {
    upstreamId: UpstreamId;
    toolName: string;
    arguments?: Record<string, unknown>;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<unknown>;
}

interface CoordinatorJournal {
  append(event: CallEvent): Promise<void>;
}

interface PolicyCallCoordinatorOptions {
  policies(input: AuthorizedToolCall): readonly Policy[];
  grants(): readonly Grant[];
  approvals: CoordinatorApprovalService;
  upstream: CoordinatorUpstream;
  journal: CoordinatorJournal;
  normalizationVersion?: number;
  describe?(input: AuthorizedToolCall): Promise<{
    description: PluginCallDescription;
    normalizationVersion: number;
    pluginId?: string;
    pluginVersion?: string;
  }>;
  approvalTimeoutMs?(input: AuthorizedToolCall): number;
  toolCallTimeoutMs?(input: AuthorizedToolCall): number;
  sensitivePaths?: readonly string[];
  now?: () => Date;
}

export class PolicyDeniedError extends Error {
  constructor(
    readonly reasonCode: string,
    readonly denialReason?: string,
  ) {
    super(
      denialReason === undefined
        ? 'Tool call denied'
        : `Tool call denied: ${denialReason}`,
    );
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
    const described = await this.#options.describe?.(input);
    const context =
      described?.description.normalizedContext ??
      (input.arguments as JsonValue);
    const normalizationVersion =
      described?.normalizationVersion ??
      this.#options.normalizationVersion ??
      1;
    const sensitivePaths = [
      ...(this.#options.sensitivePaths ?? []),
      ...(described?.description.sensitivePaths ?? []),
    ];
    const journalArguments = redact(input.arguments, {
      sensitivePaths,
      payloadLimitBytes: 64 * 1024,
    }).value;
    const presentation = this.#presentation(described, journalArguments);
    const requestHash = canonicalRequestHash({
      clientTokenId: input.clientTokenId,
      upstreamId: input.upstreamId,
      toolName: input.toolName,
      arguments: input.arguments as JsonValue,
    });
    await this.#append(input, callId, 'call.received', {
      payload: journalArguments,
      ...(presentation === undefined ? {} : { presentation }),
    });
    const decision = evaluatePolicy({
      visible: true,
      clientTokenId: input.clientTokenId,
      upstreamId: input.upstreamId,
      toolName: input.toolName,
      context,
      requestHash,
      normalizationVersion,
      policies: this.#options.policies(input),
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
        startedAt.getTime() +
          (this.#options.approvalTimeoutMs?.(input) ??
            DEFAULT_APPROVAL_TIMEOUT_SECONDS * 1_000),
      ).toISOString();
      const outcome = await this.#options.approvals.request(
        {
          callId,
          clientTokenId: input.clientTokenId,
          upstreamId: input.upstreamId,
          toolName: input.toolName,
          requestHash,
          context: redact(context, {
            sensitivePaths,
            payloadLimitBytes: 8 * 1024 * 1024,
          }).value,
          normalizationVersion,
          reasonCode: decision.reasonCode,
          expiresAt,
          ...(presentation === undefined ? {} : { presentation }),
        },
        signal,
      );
      await this.#append(input, callId, 'approval.decided', {
        approvalStatus: outcome.status,
        ...(outcome.status === 'denied' &&
        outcome.approval.denialReason !== undefined
          ? { denialReason: outcome.approval.denialReason }
          : {}),
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
        throw new PolicyDeniedError(
          outcome.approval.reasonCode,
          outcome.status === 'denied'
            ? outcome.approval.denialReason
            : undefined,
        );
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
          signal,
          timeoutMs: this.#options.toolCallTimeoutMs?.(input) ??
            DEFAULT_TOOL_CALL_TIMEOUT_SECONDS * 1_000,
        })) as CallToolResult;
        await this.#terminal(input, callId, 'success', startedAt);
        return result;
      } catch (error) {
        await this.#terminal(input, callId, 'error', startedAt, 'upstream.failed');
        throw error;
      }
    });
  }

  #presentation(
    described:
      | {
          description: PluginCallDescription;
          pluginId?: string;
          pluginVersion?: string;
        }
      | undefined,
    redactedArguments: JsonValue,
  ): CallPresentation | undefined {
    if (described === undefined) return undefined;
    const { description } = described;
    const sections =
      description.source === 'generic' && description.sections[0] !== undefined
        ? [
            {
              ...structuredClone(description.sections[0]),
              fields:
                description.sections[0].fields[0] === undefined
                  ? []
                  : [
                      {
                        ...structuredClone(description.sections[0].fields[0]),
                        value: structuredClone(redactedArguments),
                      },
                    ],
            },
          ]
        : structuredClone(description.sections);
    return {
      source: description.source,
      ...(description.reasonCode === undefined
        ? {}
        : { reasonCode: description.reasonCode }),
      ...(described.pluginId === undefined
        ? {}
        : { pluginId: described.pluginId }),
      ...(described.pluginVersion === undefined
        ? {}
        : { pluginVersion: described.pluginVersion }),
      title: structuredClone(description.title),
      sections,
      proposedScopes: structuredClone(description.proposedScopes),
    };
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
