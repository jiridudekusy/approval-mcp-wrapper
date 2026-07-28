import type {
  AdminId,
  ApprovalId,
  CallId,
  ClientTokenId,
  GrantId,
  PolicyId,
  UpstreamId,
} from './ids.js';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface VersionedRecord {
  id: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EncryptedCredentialEnvelope {
  algorithm: 'aes-256-gcm';
  ciphertext: string;
  nonce: string;
  tag: string;
  version: 1;
}

export interface Upstream extends VersionedRecord {
  id: UpstreamId;
  alias: string;
  url: string;
  credentials?: EncryptedCredentialEnvelope;
  pluginId?: string;
  allowPrivateNetwork: boolean;
}

export interface ClientTokenRecord extends VersionedRecord {
  id: ClientTokenId;
  label: string;
  hash: string;
  salt: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export type PolicyOutcome = 'allow' | 'deny' | 'require_approval';
export type PredicateOperator = 'equals' | 'exists' | 'in' | 'startsWith';

export interface Predicate {
  path: string;
  operator: PredicateOperator;
  value?: JsonValue;
}

export interface Policy extends VersionedRecord {
  id: PolicyId;
  clientTokenId: ClientTokenId;
  upstreamId: UpstreamId;
  toolName: string;
  outcome: PolicyOutcome;
  predicates: Predicate[];
  enabled: boolean;
}

export interface Grant extends VersionedRecord {
  id: GrantId;
  clientTokenId: ClientTokenId;
  upstreamId: UpstreamId;
  toolName: string;
  predicates: Predicate[];
  requestHash?: string;
  callId?: CallId;
  expiresAt?: string;
  revokedAt?: string;
  normalizationVersion: number;
  approvedBy: AdminId;
}

export type ApprovalStatus =
  | 'abandoned'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'interrupted'
  | 'pending';

export interface Approval extends VersionedRecord {
  id: ApprovalId;
  callId: CallId;
  requestHash: string;
  status: ApprovalStatus;
  reasonCode: string;
  decidedAt?: string;
  decidedBy?: AdminId;
}
