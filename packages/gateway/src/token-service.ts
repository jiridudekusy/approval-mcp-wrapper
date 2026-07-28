import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

import type {
  ClientTokenId,
  ClientTokenRecord,
} from '@approval-mcp/contracts';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export interface TokenRepository {
  save(record: ClientTokenRecord): Promise<void>;
  findById(id: ClientTokenId): Promise<ClientTokenRecord | undefined>;
  list(): Promise<readonly ClientTokenRecord[]>;
}

export class InMemoryTokenRepository implements TokenRepository {
  readonly #records = new Map<ClientTokenId, ClientTokenRecord>();

  async save(record: ClientTokenRecord): Promise<void> {
    this.#records.set(record.id, structuredClone(record));
  }

  async findById(id: ClientTokenId): Promise<ClientTokenRecord | undefined> {
    const record = this.#records.get(id);
    return record === undefined ? undefined : structuredClone(record);
  }

  async list(): Promise<readonly ClientTokenRecord[]> {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }
}

function encodeVerifier(salt: Buffer, hash: Buffer): string {
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    hash.toString('base64url'),
  ].join('$');
}

function parseVerifier(
  encoded: string,
): { n: number; r: number; p: number; hash: Buffer } | undefined {
  const [algorithm, nText, rText, pText, hashText] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    nText === undefined ||
    rText === undefined ||
    pText === undefined ||
    hashText === undefined
  ) {
    return undefined;
  }
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  const hash = Buffer.from(hashText, 'base64url');
  if (
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    n < 2 ||
    r < 1 ||
    p < 1 ||
    hash.byteLength !== KEY_LENGTH
  ) {
    return undefined;
  }
  return { n, r, p, hash };
}

async function hashToken(
  plaintext: string,
  salt: Buffer,
  options = { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      plaintext,
      salt,
      KEY_LENGTH,
      {
        N: options.n,
        r: options.r,
        p: options.p,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derived) => {
        if (error === null) resolve(derived);
        else reject(error);
      },
    );
  });
}

export class TokenService {
  readonly #repository: TokenRepository;
  readonly #now: () => Date;

  constructor(repository: TokenRepository, now: () => Date = () => new Date()) {
    this.#repository = repository;
    this.#now = now;
  }

  async create(
    label: string,
  ): Promise<{ record: ClientTokenRecord; plaintext: string }> {
    const normalizedLabel = label.trim();
    if (normalizedLabel.length === 0 || normalizedLabel.length > 120) {
      throw new Error('Token label must contain between 1 and 120 characters');
    }
    const plaintext = `amcp_${randomBytes(32).toString('base64url')}`;
    const salt = randomBytes(16);
    const hash = await hashToken(plaintext, salt);
    const now = this.#now().toISOString();
    const record: ClientTokenRecord = {
      id: randomUUID() as ClientTokenId,
      label: normalizedLabel,
      hash: encodeVerifier(salt, hash),
      salt: salt.toString('base64url'),
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.#repository.save(record);
    return { record: structuredClone(record), plaintext };
  }

  async authenticate(
    plaintext: string,
  ): Promise<ClientTokenRecord | undefined> {
    if (!/^amcp_[A-Za-z0-9_-]{43}$/.test(plaintext)) return undefined;
    const records = await this.#repository.list();
    for (const record of records) {
      if (record.revokedAt !== undefined) continue;
      const verifier = parseVerifier(record.hash);
      if (verifier === undefined) continue;
      const actual = await hashToken(
        plaintext,
        Buffer.from(record.salt, 'base64url'),
        verifier,
      );
      if (timingSafeEqual(actual, verifier.hash)) {
        const now = this.#now().toISOString();
        const updated: ClientTokenRecord = {
          ...record,
          lastUsedAt: now,
          updatedAt: now,
          version: record.version + 1,
        };
        await this.#repository.save(updated);
        return structuredClone(updated);
      }
    }
    return undefined;
  }

  async revoke(id: ClientTokenId): Promise<void> {
    const record = await this.#repository.findById(id);
    if (record === undefined) throw new Error(`Unknown client token: ${id}`);
    if (record.revokedAt !== undefined) return;
    const now = this.#now().toISOString();
    await this.#repository.save({
      ...record,
      revokedAt: now,
      updatedAt: now,
      version: record.version + 1,
    });
  }
}
