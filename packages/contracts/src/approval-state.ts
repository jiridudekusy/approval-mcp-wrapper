import type {
  Approval,
  Grant,
  JsonValue,
  Predicate,
} from './entities.js';
import type {
  AdminId,
  ApprovalId,
  CallId,
  ClientTokenId,
  UpstreamId,
} from './ids.js';

export type ApprovalDecision =
  | { action: 'deny' }
  | { action: 'allow_once' }
  | { action: 'allow_until'; expiresAt: string; predicate: Predicate }
  | { action: 'allow_forever'; predicate: Predicate };

export interface ApprovalRequestInput {
  callId: CallId;
  clientTokenId: ClientTokenId;
  upstreamId: UpstreamId;
  toolName: string;
  requestHash: string;
  context: JsonValue;
  normalizationVersion: number;
  reasonCode: string;
  expiresAt: string;
}

export type ApprovalOutcome =
  | { status: 'approved'; approval: Approval; grant: Grant }
  | { status: 'denied'; approval: Approval }
  | {
      status: 'abandoned' | 'expired' | 'interrupted';
      approval: Approval;
    };

export interface ApprovalDecisionInput {
  id: ApprovalId;
  decision: ApprovalDecision;
  actor: AdminId;
  expectedRequestHash: string;
}
