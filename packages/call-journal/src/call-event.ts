import type { JsonValue } from '@approval-mcp/contracts';

export type CallEventType =
  | 'approval.decided'
  | 'approval.requested'
  | 'call.abandoned'
  | 'call.completed'
  | 'call.failed'
  | 'call.interrupted'
  | 'call.received'
  | 'policy.decided'
  | 'upstream.started';

export interface CallEvent {
  eventId: string;
  callId: string;
  timestamp: string;
  type: CallEventType;
  clientTokenId: string;
  upstreamId: string;
  toolName: string;
  payload?: JsonValue;
  policyOutcome?: 'allow' | 'deny' | 'require_approval';
  approvalStatus?: string;
  finalStatus?: 'abandoned' | 'denied' | 'error' | 'interrupted' | 'success' | 'timeout';
  latencyMs?: number;
  reasonCode?: string;
}

export interface CallFilter {
  from?: string;
  to?: string;
  clientTokenId?: string;
  upstreamId?: string;
  toolName?: string;
  policyOutcome?: CallEvent['policyOutcome'];
  approvalStatus?: string;
  finalStatus?: CallEvent['finalStatus'];
  limit?: number;
}

export interface CallTimeline {
  callId: string;
  events: CallEvent[];
}

export interface CallSummary {
  callId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  clientTokenId: string;
  upstreamId: string;
  toolName: string;
  policyOutcome?: CallEvent['policyOutcome'];
  approvalStatus?: string;
  finalStatus?: CallEvent['finalStatus'];
}

export interface CallPage {
  items: CallSummary[];
  nextCursor?: string;
}

export interface CallDisplayNames {
  tokenLabel?: string;
  upstreamAlias?: string;
}

export type CallDisplayNameResolver = (
  event: CallEvent,
) => CallDisplayNames;

export interface JournalRecovery {
  truncatedLines: number;
}

export interface RetentionResult {
  deletedFiles: string[];
  deletedBytes: number;
}
