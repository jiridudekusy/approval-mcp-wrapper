import type {
  ClientTokenId,
  ClientTokenRecord,
  JsonValue,
} from '@approval-mcp/contracts';
import type { ConfigStateStore } from '@approval-mcp/state-store';
import { z } from 'zod';

import type { TokenRepository } from './token-service.js';

const tokenRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  hash: z.string(),
  salt: z.string(),
  revokedAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
  schemaVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().positive(),
});

function parseRecord(value: unknown): ClientTokenRecord {
  return tokenRecordSchema.parse(value) as ClientTokenRecord;
}

export class StateStoreTokenRepository implements TokenRepository {
  constructor(readonly store: ConfigStateStore) {}

  async save(record: ClientTokenRecord): Promise<void> {
    await this.store.mutate({
      type: 'record.upserted',
      collection: 'clientTokens',
      id: record.id,
      value: structuredClone(record) as unknown as JsonValue,
    });
  }

  async findById(id: ClientTokenId): Promise<ClientTokenRecord | undefined> {
    return this.store.read((state) => {
      const value = state.clientTokens[id];
      return value === undefined ? undefined : parseRecord(value);
    });
  }

  async list(): Promise<readonly ClientTokenRecord[]> {
    return this.store.read((state) =>
      Object.values(state.clientTokens).map(parseRecord),
    );
  }
}
