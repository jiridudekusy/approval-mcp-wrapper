import type { JsonValue } from '@approval-mcp/contracts';
import type {
  ConfigCollectionName,
  ConfigStateStore,
  StateOperation,
} from '@approval-mcp/state-store';

import type {
  PasskeyRecord,
  PasskeyRepository,
} from './passkey-service.js';
import type {
  RecoveryCodeRecord,
  RecoveryRepository,
} from './recovery-service.js';
import type {
  AdminSession,
  SessionRepository,
} from './session-store.js';

function cloneRecord<T>(value: JsonValue | undefined): T | undefined {
  return value === undefined ? undefined : (structuredClone(value) as T);
}

function upsert(
  collection: ConfigCollectionName,
  id: string,
  value: unknown,
): StateOperation {
  return {
    type: 'record.upserted',
    collection,
    id,
    value: structuredClone(value) as JsonValue,
  };
}

export class StatePasskeyRepository implements PasskeyRepository {
  constructor(readonly store: ConfigStateStore) {}

  async list(): Promise<readonly PasskeyRecord[]> {
    return this.store.read((state) =>
      Object.values(state.passkeys).map(
        (value) => structuredClone(value) as unknown as PasskeyRecord,
      ),
    );
  }

  async find(id: string): Promise<PasskeyRecord | undefined> {
    return this.store.read((state) =>
      cloneRecord<PasskeyRecord>(state.passkeys[id]),
    );
  }

  async save(record: PasskeyRecord): Promise<void> {
    await this.store.mutate(upsert('passkeys', record.id, record));
  }
}

export class StateSessionRepository implements SessionRepository {
  constructor(readonly store: ConfigStateStore) {}

  async save(session: AdminSession): Promise<void> {
    await this.store.mutate(upsert('adminSessions', session.id, session));
  }

  async find(id: string): Promise<AdminSession | undefined> {
    return this.store.read((state) =>
      cloneRecord<AdminSession>(state.adminSessions[id]),
    );
  }

  async list(): Promise<readonly AdminSession[]> {
    return this.store.read((state) =>
      Object.values(state.adminSessions).map(
        (value) => structuredClone(value) as unknown as AdminSession,
      ),
    );
  }

  async revokeAll(): Promise<void> {
    const revokedAt = new Date().toISOString();
    const sessions = await this.list();
    if (sessions.length === 0) return;
    await this.store.mutate({
      type: 'records.batch',
      operations: sessions.map((session) =>
        upsert('adminSessions', session.id, { ...session, revokedAt }),
      ),
    });
  }
}

export class StateRecoveryRepository implements RecoveryRepository {
  #queue: Promise<void> = Promise.resolve();

  constructor(readonly store: ConfigStateStore) {}

  async replace(records: readonly RecoveryCodeRecord[]): Promise<void> {
    await this.#serialized(async () => {
      const oldIds = this.store.read((state) =>
        Object.keys(state.recoveryCodes),
      );
      const operations: StateOperation[] = [
        ...oldIds.map(
          (id): StateOperation => ({
            type: 'record.deleted',
            collection: 'recoveryCodes',
            id,
          }),
        ),
        ...records.map((record) =>
          upsert('recoveryCodes', record.id, record),
        ),
      ];
      if (operations.length > 0) {
        await this.store.mutate({ type: 'records.batch', operations });
      }
    });
  }

  async list(): Promise<readonly RecoveryCodeRecord[]> {
    await this.#queue;
    return this.store.read((state) =>
      Object.values(state.recoveryCodes).map(
        (value) => structuredClone(value) as unknown as RecoveryCodeRecord,
      ),
    );
  }

  async consume(id: string, consumedAt: string): Promise<boolean> {
    let consumed = false;
    await this.#serialized(async () => {
      const current = this.store.read(
        (state) => state.recoveryCodes[id],
      );
      if (current === undefined) return;
      const record = structuredClone(current) as unknown as RecoveryCodeRecord;
      if (record.consumedAt !== undefined) return;
      await this.store.mutate(
        upsert('recoveryCodes', id, { ...record, consumedAt }),
      );
      consumed = true;
    });
    return consumed;
  }

  async #serialized(operation: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(operation);
    this.#queue = run.catch(() => undefined);
    await run;
  }
}
