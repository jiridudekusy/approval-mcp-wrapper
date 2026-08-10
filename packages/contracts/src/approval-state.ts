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
import type { CallPresentation } from './presentation.js';

export type ApprovalDecision =
  | { action: 'deny' }
  | { action: 'allow_once' }
  | {
      action: 'allow_until';
      expiresAt: string;
      predicate?: Predicate;
      scopeId?: string;
    }
  | { action: 'allow_forever'; predicate?: Predicate; scopeId?: string };

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
  presentation?: CallPresentation;
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
