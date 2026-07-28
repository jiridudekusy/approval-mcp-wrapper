export interface ApprovalApiRecord {
  approval: {
    id: string;
    callId: string;
    requestHash: string;
    status: string;
    createdAt: string;
  };
  request: {
    clientTokenId: string;
    upstreamId: string;
    toolName: string;
    context: unknown;
    expiresAt: string;
  };
}

export interface ApprovalViewModel {
  id: string;
  requestHash: string;
  tokenId: string;
  upstreamId: string;
  toolName: string;
  arguments: unknown;
  createdAt: string;
  expiresAt: string;
}

export function approvalViewModel(
  record: ApprovalApiRecord,
): ApprovalViewModel | undefined {
  if (record.approval.status !== 'pending') return undefined;
  return {
    id: record.approval.id,
    requestHash: record.approval.requestHash,
    tokenId: record.request.clientTokenId,
    upstreamId: record.request.upstreamId,
    toolName: record.request.toolName,
    arguments: record.request.context,
    createdAt: record.approval.createdAt,
    expiresAt: record.request.expiresAt,
  };
}
