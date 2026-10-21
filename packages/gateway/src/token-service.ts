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
const TOKEN_PATTERN =
  /^amcp_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
const DUMMY_SALT = Buffer.alloc(16);

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
    canManageApprovalMcp = false,
  ): Promise<{ record: ClientTokenRecord; plaintext: string }> {
    const normalizedLabel = label.trim();
    if (normalizedLabel.length === 0 || normalizedLabel.length > 120) {
      throw new Error('Token label must contain between 1 and 120 characters');
    }
    const id = randomUUID() as ClientTokenId;
    const plaintext = `amcp_${id}_${randomBytes(32).toString('base64url')}`;
    const salt = randomBytes(16);
    const hash = await hashToken(plaintext, salt);
    const now = this.#now().toISOString();
    const record: ClientTokenRecord = {
      id,
      label: normalizedLabel,
      ...(canManageApprovalMcp ? { canManageApprovalMcp: true } : {}),
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
    const match = TOKEN_PATTERN.exec(plaintext);
    if (match === null) return undefined;
    const record = await this.#repository.findById(match[1] as ClientTokenId);
    const verifier =
      record === undefined ? undefined : parseVerifier(record.hash);
    if (record === undefined || verifier === undefined || record.authKind === 'oauth') {
      await hashToken(plaintext, DUMMY_SALT);
      return undefined;
    }
    const actual = await hashToken(
      plaintext,
      Buffer.from(record.salt, 'base64url'),
      verifier,
    );
    if (record.revokedAt !== undefined || record.deletedAt !== undefined ||
      (record.expiresAt !== undefined && record.expiresAt <= this.#now().toISOString()) ||
      !timingSafeEqual(actual, verifier.hash)) {
      return undefined;
    }
    // Never write the verifier from an authentication snapshot: doing so could
    // restore an old secret after a concurrent rotation or deletion.
    const current = await this.#repository.findById(record.id);
    return current?.hash === record.hash &&
      current.salt === record.salt &&
      current.revokedAt === undefined &&
      current.deletedAt === undefined
      && current.authKind !== 'oauth'
      && (current.expiresAt === undefined || current.expiresAt > this.#now().toISOString())
      ? current
      : undefined;
  }

  async update(
    id: ClientTokenId,
    changes: { label?: string; canManageApprovalMcp?: boolean },
  ): Promise<ClientTokenRecord> {
    const normalizedLabel = changes.label?.trim();
    if (normalizedLabel !== undefined && (normalizedLabel.length === 0 || normalizedLabel.length > 120)) {
      throw new Error('Token label must contain between 1 and 120 characters');
    }
    const record = await this.#repository.findById(id);
    if (record === undefined || record.deletedAt !== undefined) throw new Error(`Unknown client token: ${id}`);
    if (record.authKind === 'oauth' && changes.canManageApprovalMcp === true) {
      throw new Error('OAuth clients cannot manage Approval MCP');
    }
    const updated = {
      ...record,
      ...(normalizedLabel === undefined ? {} : { label: normalizedLabel }),
      ...(changes.canManageApprovalMcp === undefined
        ? {}
        : { canManageApprovalMcp: changes.canManageApprovalMcp }),
      updatedAt: this.#now().toISOString(),
      version: record.version + 1,
    };
    await this.#repository.save(updated);
    return updated;
  }

  async rotate(id: ClientTokenId): Promise<{ record: ClientTokenRecord; plaintext: string }> {
    const record = await this.#repository.findById(id);
    if (record === undefined || record.deletedAt !== undefined || record.revokedAt !== undefined || record.authKind === 'oauth') {
      throw new Error(`Unknown active client token: ${id}`);
    }
    const plaintext = `amcp_${id}_${randomBytes(32).toString('base64url')}`;
    const salt = randomBytes(16);
    const hash = await hashToken(plaintext, salt);
    const updated = {
      ...record,
      hash: encodeVerifier(salt, hash),
      salt: salt.toString('base64url'),
      updatedAt: this.#now().toISOString(),
      version: record.version + 1,
    };
    await this.#repository.save(updated);
    return { record: updated, plaintext };
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
