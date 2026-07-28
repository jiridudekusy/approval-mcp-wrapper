import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

export interface RecoveryCodeRecord {
  id: string;
  salt: string;
  hash: string;
  createdAt: string;
  consumedAt?: string;
}

export interface RecoveryRepository {
  replace(records: readonly RecoveryCodeRecord[]): Promise<void>;
  list(): Promise<readonly RecoveryCodeRecord[]>;
  consume(id: string, consumedAt: string): Promise<boolean>;
}

export class InMemoryRecoveryRepository implements RecoveryRepository {
  readonly #records = new Map<string, RecoveryCodeRecord>();

  async replace(records: readonly RecoveryCodeRecord[]): Promise<void> {
    this.#records.clear();
    for (const record of records) {
      this.#records.set(record.id, structuredClone(record));
    }
  }

  async list(): Promise<readonly RecoveryCodeRecord[]> {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }

  async consume(id: string, consumedAt: string): Promise<boolean> {
    const record = this.#records.get(id);
    if (record === undefined || record.consumedAt !== undefined) return false;
    this.#records.set(id, { ...record, consumedAt });
    return true;
  }
}

function derive(code: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      code,
      salt,
      32,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => (error === null ? resolve(result) : reject(error)),
    );
  });
}

function printableCode(): string {
  const value = randomBytes(10).toString('hex').toUpperCase();
  return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15)}`;
}

export class RecoveryService {
  #verificationActive = false;

  constructor(
    readonly repository: RecoveryRepository,
    readonly now: () => Date = () => new Date(),
  ) {}

  async generate(): Promise<string[]> {
    const codes = Array.from({ length: 10 }, printableCode);
    const records = await Promise.all(
      codes.map(async (code): Promise<RecoveryCodeRecord> => {
        const salt = randomBytes(16);
        return {
          id: randomUUID(),
          salt: salt.toString('base64url'),
          hash: (await derive(code, salt)).toString('base64url'),
          createdAt: this.now().toISOString(),
        };
      }),
    );
    await this.repository.replace(records);
    return codes;
  }

  async consume(code: string): Promise<boolean> {
    if (!/^[0-9A-F]{5}(?:-[0-9A-F]{5}){3}$/.test(code)) return false;
    if (this.#verificationActive) return false;
    this.#verificationActive = true;
    try {
      for (const record of await this.repository.list()) {
        if (record.consumedAt !== undefined) continue;
        const actual = await derive(code, Buffer.from(record.salt, 'base64url'));
        const expected = Buffer.from(record.hash, 'base64url');
        if (
          actual.byteLength === expected.byteLength &&
          timingSafeEqual(actual, expected)
        ) {
          return this.repository.consume(record.id, this.now().toISOString());
        }
      }
      return false;
    } finally {
      this.#verificationActive = false;
    }
  }
}
