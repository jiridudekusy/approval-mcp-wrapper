import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { ClientTokenId, ClientTokenRecord, JsonValue, Profile, ProfileId, TokenProfileAssignment, StorageCodec } from '@approval-mcp/contracts';
import { StorageCipher, type ConfigStateStore, type StateOperation } from '@approval-mcp/state-store';
import { z } from 'zod';

const REQUEST_LIFETIME_MS = 10 * 60_000;
const CODE_LIFETIME_MS = 5 * 60_000;
const ACCESS_LIFETIME_MS = 15 * 60_000;
export const REFRESH_REUSE_GRACE_MS = 30 * 60_000;
const MAX_GRANT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const SETUP_SCOPE = 'setup:submit';
export const MAX_SETUP_GRANT_SECONDS = 30 * 60;
type OAuthScope = 'mcp:access' | typeof SETUP_SCOPE;

interface OAuthClient {
  id: string;
  name: string;
  issuer?: string;
  redirectUris: string[];
  createdAt: string;
}

interface OAuthRequest {
  id: string;
  clientId: string;
  issuer?: string;
  redirectUri: string;
  resource: string;
  scope?: OAuthScope;
  codeChallenge: string;
  state?: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'denied';
  decidedByAdminId?: string;
  decidedAt?: string;
}

interface OAuthCode {
  grantId: string;
  issuer?: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  codeChallenge: string;
  expiresAt: string;
}

interface OAuthGrant {
  id: string;
  clientTokenId: ClientTokenId;
  clientId: string;
  issuer?: string;
  resource?: string;
  scope?: OAuthScope;
  profileId?: ProfileId;
  profileVersion?: number;
  createdAt: string;
  approvedByAdminId: string;
  expiresAt: string;
  revokedAt?: string;
  /** Setup grants are bound durably to one immutable declaration, even across restart. */
  setupRequestDigest?: string;
  refreshGeneration?: number;
  refreshResponse?: {
    sealed: string;
    accessExpiresAt: string;
    refreshTokenHash?: string;
  };
}

interface OAuthToken {
  grantId: string;
  kind: 'access' | 'refresh';
  expiresAt: string;
  usedAt?: string;
  generation?: number;
}

interface OAuthTokenResponse {
  access_token: string; token_type: 'Bearer'; expires_in: number;
  refresh_token?: string; scope: string;
}
const responseSchema = z.object({
  access_token: z.string().regex(/^amcpoa_[A-Za-z0-9_-]{43}$/),
  token_type: z.literal('Bearer'), expires_in: z.number().int().positive(),
  refresh_token: z.string().regex(/^amcpor_[A-Za-z0-9_-]{43}$/).optional(), scope: z.enum(['mcp:access', SETUP_SCOPE]),
}).strict();

export class OAuthError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
  }
}

export interface OAuthRefreshDiagnostic {
  event: 'oauth.refresh';
  timestamp: string;
  outcome: 'issued' | 'reused' | 'rejected';
  reason?: 'grant_expired' | 'grant_inactive' | 'binding_mismatch' | 'token_expired' | 'replay_detected' | 'reuse_within_grace';
  grantId?: string;
  agentId?: string;
  grantExpiresAt?: string;
  usedAgoMs?: number;
  tokenGeneration?: number;
  currentGeneration?: number;
  isLatestParent?: boolean;
}

function hash(value: string): string {
  return createHash('sha256').update(`approval-mcp:oauth:${value}`).digest('hex');
}

function redirectUriAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '' || url.hash !== '' ||
      ['code', 'state', 'iss', 'error'].some((key) => url.searchParams.has(key))) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function record<T>(value: JsonValue | undefined): T | undefined {
  return value === undefined ? undefined : value as T;
}

function upsert(collection: StateOperation['collection'], id: string, value: unknown): StateOperation {
  return { type: 'record.upserted', collection, id, value: value as JsonValue };
}

function redirectWith(uri: string, values: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export class OAuthService {
  readonly issuer: string;
  readonly resource: string;
  readonly #state: ConfigStateStore;
  readonly #now: () => Date;
  readonly #originByHost: ReadonlyMap<string, string>;
  readonly #onRefreshDiagnostic: ((event: OAuthRefreshDiagnostic) => void) | undefined;
  readonly #refreshResponseCodec: StorageCodec;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    state: ConfigStateStore,
    publicOrigin: string,
    now: () => Date = () => new Date(),
    origins: readonly string[] = [publicOrigin],
    onRefreshDiagnostic?: (event: OAuthRefreshDiagnostic) => void,
    refreshResponseCodec: StorageCodec = new StorageCipher(randomBytes(32), 'oauth-refresh-response-cache'),
  ) {
    this.#state = state;
    this.issuer = publicOrigin;
    this.resource = `${publicOrigin}/mcp`;
    this.#now = now;
    this.#onRefreshDiagnostic = onRefreshDiagnostic;
    this.#refreshResponseCodec = refreshResponseCodec;
    this.#originByHost = new Map(origins.map((origin) => [new URL(origin).host.toLowerCase(), origin]));
    if (!this.#originByHost.has(new URL(publicOrigin).host.toLowerCase())) {
      throw new Error('The passkey origin must be an allowed OAuth origin');
    }
  }

  originForHost(host: string | undefined): string | undefined {
    return host === undefined ? undefined : this.#originByHost.get(host.toLowerCase());
  }

  resourceFor(origin: string, scope: OAuthScope = 'mcp:access'): string {
    if (this.originForHost(new URL(origin).host) !== origin) throw new OAuthError('invalid_resource');
    return `${origin}${scope === SETUP_SCOPE ? '/api/setup' : '/mcp'}`;
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }

  #reportRefresh(event: Omit<OAuthRefreshDiagnostic, 'event' | 'timestamp'>): void {
    try {
      this.#onRefreshDiagnostic?.({ event: 'oauth.refresh', timestamp: this.#now().toISOString(), ...event });
    } catch {
      // Diagnostics must never change the result of a token refresh.
    }
  }

  async registerClient(name: string, redirectUris: readonly string[], issuer = this.issuer): Promise<OAuthClient> {
    if (this.originForHost(new URL(issuer).host) !== issuer) throw new OAuthError('invalid_client_metadata');
    if (name.trim().length === 0 || name.length > 120 || redirectUris.length < 1 || redirectUris.length > 8 ||
      redirectUris.some((uri) => uri.length > 2048 || !redirectUriAllowed(uri))) {
      throw new OAuthError('invalid_client_metadata');
    }
    const client: OAuthClient = {
      id: randomUUID(), name: name.trim(), issuer, redirectUris: [...new Set(redirectUris)],
      createdAt: this.#now().toISOString(),
    };
    await this.#state.mutate(upsert('oauthClients', client.id, client));
    return client;
  }

  async request(input: {
    clientId: string;
    redirectUri: string;
    resource: string;
    responseType: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope?: string;
    state?: string;
  }): Promise<string> {
    const client = this.#state.read((state) => record<OAuthClient>(state.oauthClients[input.clientId]));
    if (client === undefined || !client.redirectUris.includes(input.redirectUri)) throw new OAuthError('invalid_client');
    const issuer = client.issuer ?? this.issuer;
    const scope = input.scope ?? 'mcp:access';
    if ((scope !== 'mcp:access' && scope !== SETUP_SCOPE) ||
      input.responseType !== 'code' || input.resource !== this.resourceFor(issuer, scope) ||
      input.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge) ||
      (input.state !== undefined && input.state.length > 1024)) {
      throw new OAuthError('invalid_request');
    }
    const request: OAuthRequest = {
      id: randomUUID(), clientId: client.id, issuer, redirectUri: input.redirectUri,
      resource: input.resource, scope, codeChallenge: input.codeChallenge,
      ...(input.state === undefined ? {} : { state: input.state }),
      expiresAt: new Date(this.#now().getTime() + REQUEST_LIFETIME_MS).toISOString(),
      status: 'pending',
    };
    await this.#state.mutate(upsert('oauthRequests', request.id, request));
    return request.id;
  }

  pending(id: string): { clientName: string; clientId: string; redirectUri: string; resource: string; scope: OAuthScope; profiles: { id: string; name: string; version: number; ruleCount: number }[] } {
    return this.#state.read((state) => {
      const request = record<OAuthRequest>(state.oauthRequests[id]);
      if (request === undefined || request.status !== 'pending' || request.expiresAt <= this.#now().toISOString()) {
        throw new OAuthError('invalid_request', 404);
      }
      const client = record<OAuthClient>(state.oauthClients[request.clientId]);
      if (client === undefined) throw new OAuthError('invalid_client', 404);
      return {
        clientName: client.name, clientId: client.id, redirectUri: request.redirectUri,
        resource: request.resource,
        scope: request.scope ?? 'mcp:access',
        profiles: request.scope === SETUP_SCOPE ? [] : Object.values(state.profiles).map((value) => value as unknown as Profile)
          .map((profile) => ({
            id: profile.id, name: profile.name, version: profile.version,
            ruleCount: Object.values(state.profileRules).filter((value) =>
              (value as { profileId?: unknown; enabled?: unknown }).profileId === profile.id &&
              (value as { enabled?: unknown }).enabled === true).length,
          })),
      };
    });
  }

  async approve(id: string, profileId: string, lifetimeSeconds: number | undefined, adminId: string, label?: string): Promise<string> {
    return this.#serialize(async () => {
      if (label !== undefined && (label.trim().length === 0 || label.trim().length > 120)) {
        throw new OAuthError('invalid_agent_label');
      }
      const now = this.#now();
      const snapshot = this.#state.read((state) => ({
        request: record<OAuthRequest>(state.oauthRequests[id]),
        profile: record<Profile>(state.profiles[profileId]),
      }));
      const { request, profile } = snapshot;
      if (request === undefined || request.status !== 'pending' || request.expiresAt <= now.toISOString()) {
        throw new OAuthError('invalid_request', 404);
      }
      const isSetup = request.scope === SETUP_SCOPE;
      // Setup lifetime is a server-owned safety bound, never a consent form choice.
      const lifetime = isSetup ? MAX_SETUP_GRANT_SECONDS : lifetimeSeconds;
      if (lifetime === undefined || !Number.isInteger(lifetime) || lifetime < 300 || lifetime > MAX_GRANT_LIFETIME_SECONDS) {
        throw new OAuthError('invalid_grant_lifetime');
      }
      if (isSetup && profileId !== '') throw new OAuthError('invalid_request');
      if (!isSetup && profile === undefined) throw new OAuthError('invalid_profile');
      const clientTokenId = randomUUID() as ClientTokenId;
      const grantId = randomUUID();
      const code = randomBytes(32).toString('base64url');
      const codeRecord: OAuthCode = {
        grantId, clientId: request.clientId, issuer: request.issuer ?? this.issuer, redirectUri: request.redirectUri,
        resource: request.resource, codeChallenge: request.codeChallenge,
        expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS).toISOString(),
      };
      const grant: OAuthGrant = {
        id: grantId, clientTokenId, clientId: request.clientId,
        issuer: request.issuer ?? this.issuer, resource: request.resource,
        scope: request.scope ?? 'mcp:access',
        ...(!isSetup && profile !== undefined ? { profileId: profile.id, profileVersion: profile.version } : {}),
        createdAt: now.toISOString(),
        approvedByAdminId: adminId,
        expiresAt: new Date(now.getTime() + lifetime * 1000).toISOString(),
      };
      const client = this.#state.read((state) => record<OAuthClient>(state.oauthClients[request.clientId]));
      const agent: ClientTokenRecord = {
        id: clientTokenId, label: label?.trim() ?? client?.name ?? 'OAuth sandbox', authKind: 'oauth',
        hash: '', salt: '', expiresAt: grant.expiresAt,
        schemaVersion: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 1,
      };
      const assignment: TokenProfileAssignment | undefined = isSetup || profile === undefined ? undefined : {
        id: randomUUID() as TokenProfileAssignment['id'], clientTokenId, profileId: profile.id,
        schemaVersion: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 1,
      };
      await this.#state.mutate({ type: 'records.batch', operations: [
        upsert('clientTokens', clientTokenId, agent),
        ...(assignment === undefined ? [] : [upsert('tokenProfileAssignments', assignment.id, assignment)]),
        upsert('oauthGrants', grantId, grant),
        upsert('oauthCodes', hash(code), codeRecord),
        upsert('oauthRequests', id, { ...request, status: 'approved', decidedByAdminId: adminId, decidedAt: now.toISOString() }),
      ] });
      return redirectWith(request.redirectUri, { code, state: request.state, iss: request.issuer ?? this.issuer });
    });
  }

  /** One setup declaration per grant; identical retries remain safe and idempotent. */
  claimSetup(clientTokenId: string, inputDigest: string): Promise<boolean> {
    return this.#state.transact((state) => {
      const grant = Object.values(state.oauthGrants).map((value) => value as unknown as OAuthGrant)
        .find((value) => value.clientTokenId === clientTokenId && value.scope === SETUP_SCOPE);
      const agent = record<ClientTokenRecord>(state.clientTokens[clientTokenId]);
      if (grant === undefined || grant.revokedAt !== undefined || grant.expiresAt <= this.#now().toISOString() ||
        agent?.authKind !== 'oauth' || agent.revokedAt !== undefined || agent.deletedAt !== undefined ||
        (grant.setupRequestDigest !== undefined && grant.setupRequestDigest !== inputDigest)) return { result: false };
      return { result: true, ...(grant.setupRequestDigest === undefined ? {
        event: { type: 'records.batch' as const, operations: [upsert('oauthGrants', grant.id, { ...grant, setupRequestDigest: inputDigest })] },
      } : {}) };
    });
  }

  /** Called only after the owning client acknowledges a terminal setup result. */
  async completeSetup(clientTokenId: string): Promise<void> {
    await this.#state.transact((state) => {
      const grant = Object.values(state.oauthGrants).map((value) => value as unknown as OAuthGrant)
        .find((value) => value.clientTokenId === clientTokenId && value.scope === SETUP_SCOPE);
      const agent = record<ClientTokenRecord>(state.clientTokens[clientTokenId]);
      if (grant === undefined || grant.revokedAt !== undefined) return { result: undefined };
      const revokedAt = this.#now().toISOString();
      return { result: undefined, event: { type: 'records.batch' as const, operations: [
        upsert('oauthGrants', grant.id, { ...grant, revokedAt }),
        ...(agent === undefined ? [] : [upsert('clientTokens', agent.id, { ...agent, revokedAt, updatedAt: revokedAt, version: agent.version + 1 })]),
      ] } };
    });
  }

  async deny(id: string, adminId: string): Promise<string> {
    return this.#serialize(async () => {
      const request = this.#state.read((state) => record<OAuthRequest>(state.oauthRequests[id]));
      if (request === undefined || request.status !== 'pending' || request.expiresAt <= this.#now().toISOString()) {
        throw new OAuthError('invalid_request', 404);
      }
      await this.#state.mutate(upsert('oauthRequests', id, {
        ...request, status: 'denied', decidedByAdminId: adminId, decidedAt: this.#now().toISOString(),
      }));
      return redirectWith(request.redirectUri, { error: 'access_denied', state: request.state, iss: request.issuer ?? this.issuer });
    });
  }

  #activeGrant(id: string): OAuthGrant | undefined {
    return this.#state.read((state) => {
      const grant = record<OAuthGrant>(state.oauthGrants[id]);
      if (grant === undefined || grant.revokedAt !== undefined || grant.expiresAt <= this.#now().toISOString()) return undefined;
      const agent = record<ClientTokenRecord>(state.clientTokens[grant.clientTokenId]);
      if (agent?.authKind !== 'oauth' || agent.deletedAt !== undefined || agent.revokedAt !== undefined) return undefined;
      if (grant.scope === SETUP_SCOPE) return grant;
      const profile = grant.profileId === undefined ? undefined : record<Profile>(state.profiles[grant.profileId]);
      const assignments = Object.values(state.tokenProfileAssignments)
        .map((value) => value as unknown as TokenProfileAssignment)
        .filter((item) => item.clientTokenId === grant.clientTokenId);
      return agent?.authKind === 'oauth' && agent.deletedAt === undefined && agent.revokedAt === undefined &&
        profile?.version === grant.profileVersion && assignments.length === 1 &&
        assignments[0]?.profileId === grant.profileId ? grant : undefined;
    });
  }

  async #issue(grant: OAuthGrant, extraOperations: StateOperation[]): Promise<OAuthTokenResponse> {
    const now = this.#now();
    const remainingMs = new Date(grant.expiresAt).getTime() - now.getTime();
    if (remainingMs <= 0) throw new OAuthError('invalid_grant');
    const accessToken = `amcpoa_${randomBytes(32).toString('base64url')}`;
    const isSetup = grant.scope === SETUP_SCOPE;
    const accessLifetimeMs = Math.min(isSetup ? MAX_SETUP_GRANT_SECONDS * 1000 : ACCESS_LIFETIME_MS, remainingMs);
    const generation = (grant.refreshGeneration ?? 0) + 1;
    const access: OAuthToken = {
      grantId: grant.id, kind: 'access',
      expiresAt: new Date(now.getTime() + accessLifetimeMs).toISOString(), generation,
    };
    // Keep a single refresh lineage, including when an ancestor retries after
    // the cached access token expired or an older server has no response cache.
    const candidates = this.#state.read((state) => grant.refreshResponse?.refreshTokenHash !== undefined
      ? [[grant.refreshResponse.refreshTokenHash, state.oauthTokens[grant.refreshResponse.refreshTokenHash]]] as const
      : Object.entries(state.oauthTokens));
    const retired: StateOperation[] = [];
    for (const [id, value] of candidates) {
      const token = record<OAuthToken>(value);
      if (token?.grantId === grant.id && token.kind === 'refresh' && token.usedAt === undefined) {
        retired.push(upsert('oauthTokens', id, { ...token, usedAt: now.toISOString() }));
      }
    }
    const operations = [...retired, ...extraOperations, upsert('oauthTokens', hash(accessToken), access)];
    let refreshToken: string | undefined;
    if (!isSetup && remainingMs > ACCESS_LIFETIME_MS) {
      refreshToken = `amcpor_${randomBytes(32).toString('base64url')}`;
      operations.push(upsert('oauthTokens', hash(refreshToken), {
        grantId: grant.id, kind: 'refresh', expiresAt: grant.expiresAt, generation,
      } satisfies OAuthToken));
    }
    const response: OAuthTokenResponse = {
      access_token: accessToken, token_type: 'Bearer',
      expires_in: Math.max(1, Math.floor(accessLifetimeMs / 1000)),
      ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
      scope: grant.scope ?? 'mcp:access',
    };
    operations.push(upsert('oauthGrants', grant.id, {
      ...grant, refreshGeneration: generation,
      refreshResponse: {
        sealed: this.#refreshResponseCodec.encode(`oauth-refresh-response/${grant.id}`, JSON.stringify(response)),
        accessExpiresAt: access.expiresAt,
        ...(refreshToken === undefined ? {} : { refreshTokenHash: hash(refreshToken) }),
      },
    } satisfies OAuthGrant));
    await this.#state.mutate({ type: 'records.batch', operations });
    return response;
  }

  #cachedResponse(grant: OAuthGrant): OAuthTokenResponse | undefined {
    const cache = grant.refreshResponse;
    if (cache === undefined) return undefined;
    const remainingMs = Date.parse(cache.accessExpiresAt) - this.#now().getTime();
    if (!Number.isFinite(remainingMs)) throw new OAuthError('server_error', 500);
    if (remainingMs < 1000) return undefined;
    const response = responseSchema.parse(JSON.parse(this.#refreshResponseCodec.decode(
      `oauth-refresh-response/${grant.id}`, cache.sealed,
    ))) as OAuthTokenResponse;
    const valid = this.#state.read((state) => {
      const access = record<OAuthToken>(state.oauthTokens[hash(response.access_token)]);
      if (access?.grantId !== grant.id || access.kind !== 'access' || access.expiresAt !== cache.accessExpiresAt) return false;
      if (response.refresh_token === undefined) return cache.refreshTokenHash === undefined;
      if (hash(response.refresh_token) !== cache.refreshTokenHash) return false;
      const refresh = record<OAuthToken>(state.oauthTokens[cache.refreshTokenHash]);
      return refresh?.grantId === grant.id && refresh.kind === 'refresh' && refresh.usedAt === undefined && refresh.expiresAt > this.#now().toISOString();
    });
    if (!valid) throw new OAuthError('server_error', 500);
    // The response is shared, not renewed: never extend the stored access lifetime.
    return { ...response, expires_in: Math.floor(remainingMs / 1000) };
  }

  async exchangeCode(input: { code: string; clientId: string; redirectUri: string; resource: string; codeVerifier: string; issuer?: string }) {
    return this.#serialize(async () => {
      const key = hash(input.code);
      const code = this.#state.read((state) => record<OAuthCode>(state.oauthCodes[key]));
      if (code === undefined || code.expiresAt <= this.#now().toISOString() || code.clientId !== input.clientId ||
        code.redirectUri !== input.redirectUri || code.resource !== input.resource ||
        (code.issuer ?? this.issuer) !== (input.issuer ?? this.issuer) ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) throw new OAuthError('invalid_grant');
      const challenge = createHash('sha256').update(input.codeVerifier).digest('base64url');
      if (!timingSafeEqual(Buffer.from(challenge), Buffer.from(code.codeChallenge))) throw new OAuthError('invalid_grant');
      const grant = this.#activeGrant(code.grantId);
      if (grant === undefined) throw new OAuthError('invalid_grant');
      return this.#issue(grant, [{ type: 'record.deleted', collection: 'oauthCodes', id: key }]);
    });
  }

  async refresh(input: { refreshToken: string; clientId: string; resource: string; issuer?: string }) {
    return this.#serialize(async () => {
      const key = hash(input.refreshToken);
      const token = this.#state.read((state) => record<OAuthToken>(state.oauthTokens[key]));
      if (token === undefined || token.kind !== 'refresh') {
        // Unknown tokens are unauthenticated input; do not allow them to flood diagnostics.
        throw new OAuthError('invalid_grant');
      }
      const grant = this.#activeGrant(token.grantId);
      if (grant === undefined) {
        const stored = this.#state.read((state) => record<OAuthGrant>(state.oauthGrants[token.grantId]));
        this.#reportRefresh({
          outcome: 'rejected',
          reason: stored !== undefined && stored.expiresAt <= this.#now().toISOString()
            ? 'grant_expired' : 'grant_inactive',
          grantId: token.grantId,
          ...(stored === undefined ? {} : { agentId: stored.clientTokenId }),
        });
        throw new OAuthError('invalid_grant');
      }
      const identity = { grantId: grant.id, agentId: grant.clientTokenId };
      if (grant.clientId !== input.clientId ||
        (grant.issuer ?? this.issuer) !== (input.issuer ?? this.issuer) ||
        input.resource !== (grant.resource ?? this.resource)) {
        this.#reportRefresh({ outcome: 'rejected', reason: 'binding_mismatch', ...identity });
        throw new OAuthError('invalid_grant');
      }
      if (token.expiresAt <= this.#now().toISOString()) {
        this.#reportRefresh({ outcome: 'rejected', reason: 'token_expired', ...identity });
        throw new OAuthError('invalid_grant');
      }
      if (token.usedAt !== undefined) {
        const usedAgoMs = this.#now().getTime() - Date.parse(token.usedAt);
        const generation = {
          ...(token.generation === undefined ? {} : { tokenGeneration: token.generation }),
          ...(grant.refreshGeneration === undefined ? {} : { currentGeneration: grant.refreshGeneration }),
          ...(token.generation === undefined || grant.refreshGeneration === undefined ? {} : { isLatestParent: token.generation === grant.refreshGeneration - 1 }),
          ...(Number.isFinite(usedAgoMs) ? { usedAgoMs } : {}),
        };
        // Fixed from FIRST use. Retries must never slide this window forward.
        // Any recent ancestor can converge on the latest pair (not just its parent).
        if (usedAgoMs >= 0 && usedAgoMs < REFRESH_REUSE_GRACE_MS) {
          const cached = this.#cachedResponse(grant);
          const response = cached ?? await this.#issue(grant, []);
          this.#reportRefresh({ outcome: cached === undefined ? 'issued' : 'reused', reason: 'reuse_within_grace',
            ...identity, ...generation,
            currentGeneration: cached === undefined ? (grant.refreshGeneration ?? 0) + 1 : grant.refreshGeneration!,
            grantExpiresAt: grant.expiresAt });
          return response;
        }
        await this.#state.mutate(upsert('oauthGrants', grant.id, { ...grant, revokedAt: this.#now().toISOString() }));
        this.#reportRefresh({ outcome: 'rejected', reason: 'replay_detected', ...identity, ...generation });
        throw new OAuthError('invalid_grant');
      }
      const issued = await this.#issue(grant, [upsert('oauthTokens', key, { ...token, usedAt: this.#now().toISOString() })]);
      this.#reportRefresh({ outcome: 'issued', ...identity, currentGeneration: (grant.refreshGeneration ?? 0) + 1, grantExpiresAt: grant.expiresAt });
      return issued;
    });
  }

  authenticate(accessToken: string, resourceOrigin = this.issuer, scope: OAuthScope = 'mcp:access'): ClientTokenId | undefined {
    if (!/^amcpoa_[A-Za-z0-9_-]{43}$/.test(accessToken)) return undefined;
    const token = this.#state.read((state) => record<OAuthToken>(state.oauthTokens[hash(accessToken)]));
    if (token?.kind !== 'access' || token.expiresAt <= this.#now().toISOString()) return undefined;
    const grant = this.#activeGrant(token.grantId);
    return grant !== undefined && (grant.scope ?? 'mcp:access') === scope &&
      (grant.resource ?? this.resource) === `${resourceOrigin}${scope === SETUP_SCOPE ? '/api/setup' : '/mcp'}`
      ? grant.clientTokenId : undefined;
  }
}
