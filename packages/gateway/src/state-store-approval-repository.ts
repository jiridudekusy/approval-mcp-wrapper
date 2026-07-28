import type {
  ApprovalId,
  JsonValue,
} from '@approval-mcp/contracts';
import type { ConfigStateStore, StateOperation } from '@approval-mcp/state-store';
import { z } from 'zod';

import type {
  ApprovalRecord,
  ApprovalRepository,
} from './approval-orchestrator.js';

const persistedApprovalRecordSchema = z.object({
  approval: z.object({
    id: z.string().min(1),
    status: z.enum([
      'abandoned',
      'approved',
      'denied',
      'expired',
      'interrupted',
      'pending',
    ]),
    requestHash: z.string(),
  }),
  request: z.object({
    callId: z.string().min(1),
    requestHash: z.string(),
  }),
  grant: z.object({ id: z.string().min(1) }).passthrough().optional(),
}).passthrough();

function parseRecord(value: unknown): ApprovalRecord {
  persistedApprovalRecordSchema.parse(value);
  return structuredClone(value) as ApprovalRecord;
}

export class StateStoreApprovalRepository implements ApprovalRepository {
  #queue: Promise<void> = Promise.resolve();

  constructor(readonly store: ConfigStateStore) {}

  async create(record: ApprovalRecord): Promise<void> {
    await this.#serialized(async () => {
      const exists = this.store.read(
        (state) => state.approvals[record.approval.id] !== undefined,
      );
      if (exists) throw new Error('Approval already exists');
      await this.store.mutate({
        type: 'record.upserted',
        collection: 'approvals',
        id: record.approval.id,
        value: structuredClone(record) as unknown as JsonValue,
      });
    });
  }

  async find(id: ApprovalId): Promise<ApprovalRecord | undefined> {
    await this.#queue;
    return this.store.read((state) => {
      const value = state.approvals[id];
      return value === undefined ? undefined : parseRecord(value);
    });
  }

  async list(): Promise<readonly ApprovalRecord[]> {
    await this.#queue;
    return this.store.read((state) =>
      Object.values(state.approvals).map(parseRecord),
    );
  }

  async transition(
    id: ApprovalId,
    update: (current: ApprovalRecord) => ApprovalRecord,
  ): Promise<ApprovalRecord> {
    let result: ApprovalRecord | undefined;
    await this.#serialized(async () => {
      const current = this.store.read((state) => state.approvals[id]);
      if (current === undefined) throw new Error(`Unknown approval: ${id}`);
      result = structuredClone(update(parseRecord(current)));
      const operations: StateOperation[] = [
        {
          type: 'record.upserted',
          collection: 'approvals',
          id,
          value: structuredClone(result) as unknown as JsonValue,
        },
      ];
      if (result.grant !== undefined) {
        operations.push({
          type: 'record.upserted',
          collection: 'grants',
          id: result.grant.id,
          value: structuredClone(result.grant) as unknown as JsonValue,
        });
      }
      await this.store.mutate({ type: 'records.batch', operations });
    });
    if (result === undefined) throw new Error('Approval transition failed');
    return structuredClone(result);
  }

  async #serialized(operation: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(operation);
    this.#queue = run.catch(() => undefined);
    await run;
  }
}
