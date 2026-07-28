import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

export interface AdminSession {
  id: string;
  adminId: string;
  tokenHash: string;
  csrfHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface SessionRepository {
  save(session: AdminSession): Promise<void>;
  find(id: string): Promise<AdminSession | undefined>;
  list(): Promise<readonly AdminSession[]>;
  revokeAll(): Promise<void>;
}

export class InMemorySessionRepository implements SessionRepository {
  readonly #sessions = new Map<string, AdminSession>();

  async save(session: AdminSession): Promise<void> {
    this.#sessions.set(session.id, structuredClone(session));
  }

  async find(id: string): Promise<AdminSession | undefined> {
    const session = this.#sessions.get(id);
    return session === undefined ? undefined : structuredClone(session);
  }

  async list(): Promise<readonly AdminSession[]> {
    return [...this.#sessions.values()].map((session) =>
      structuredClone(session),
    );
  }

  async revokeAll(): Promise<void> {
    const revokedAt = new Date().toISOString();
    for (const [id, session] of this.#sessions) {
      this.#sessions.set(id, { ...session, revokedAt });
    }
  }
}

function hash(value: string): string {
  return createHash('sha256')
    .update(`approval-mcp:admin-session:${value}`)
    .digest('base64url');
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'base64url');
  const rightBuffer = Buffer.from(right, 'base64url');
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export class SessionService {
  constructor(
    readonly repository: SessionRepository,
    readonly now: () => Date = () => new Date(),
    readonly lifetimeMs = 12 * 60 * 60_000,
  ) {}

  async create(adminId: string): Promise<{
    id: string;
    plaintext: string;
    csrfToken: string;
    expiresAt: string;
  }> {
    const id = randomUUID();
    const plaintext = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + this.lifetimeMs).toISOString();
    await this.repository.save({
      id,
      adminId,
      tokenHash: hash(plaintext),
      csrfHash: hash(csrfToken),
      createdAt,
      expiresAt,
    });
    return { id, plaintext, csrfToken, expiresAt };
  }

  async authenticate(
    plaintext: string,
    csrfToken?: string,
  ): Promise<AdminSession | undefined> {
    const tokenHash = hash(plaintext);
    for (const session of await this.repository.list()) {
      if (
        session.revokedAt !== undefined ||
        session.expiresAt <= this.now().toISOString() ||
        !equalHash(session.tokenHash, tokenHash)
      ) {
        continue;
      }
      if (
        csrfToken !== undefined &&
        !equalHash(session.csrfHash, hash(csrfToken))
      ) {
        return undefined;
      }
      return session;
    }
    return undefined;
  }

  async revoke(id: string): Promise<void> {
    const session = await this.repository.find(id);
    if (session === undefined || session.revokedAt !== undefined) return;
    await this.repository.save({
      ...session,
      revokedAt: this.now().toISOString(),
    });
  }
}
