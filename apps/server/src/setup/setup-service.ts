import { createHash, randomUUID } from 'node:crypto';

import type {
  EncryptedCredentialEnvelope,
  JsonValue,
  Upstream,
  UpstreamId,
} from '@approval-mcp/contracts';
import type { ConfigState, ConfigStateStore, StateOperation } from '@approval-mcp/state-store';
import type { CredentialVault, UpstreamCredentials } from '@approval-mcp/upstream';

import {
  parseCredentials,
  parseSetupDeclaration,
  withoutCredentials,
  type SetupDeclaration,
} from './setup-declaration.js';
import { SetupError } from './setup-error.js';
import { probeMcp, type ProbeResult } from './setup-probe.js';
import type { McpConnectInput } from '@approval-mcp/upstream';
import {
  canonicalJson,
  computeSetupPlan,
  type DesiredUpstream,
  type SetupAction,
  type SetupPlan,
  type SetupPlanItem,
} from './setup-plan.js';

export const SETUP_REQUEST_LIFETIME_MS = 15 * 60_000;
/** Pending requests one client token may hold, so no requester can block the others. */
export const MAX_PENDING_SETUP_REQUESTS_PER_TOKEN = 3;
/** How long a decided request stays readable, so a polling CLI sees the outcome. */
export const DECIDED_SETUP_RETENTION_MS = 5 * 60_000;

export type SetupRequestStatus = 'pending' | 'applied' | 'denied';

/** The client token a request was submitted with. */
export interface SetupRequester {
  id: string;
  label: string;
  singleUse?: boolean;
}

/**
 * What the requester sees about one upstream. Values inherited from the stored
 * upstream (display name, metadata, ids, credential state) appear only in the
 * admin's approval view.
 */
export interface SetupItemSummary {
  alias: string;
  action: SetupAction;
}

export interface SetupResult {
  alias: string;
  action: SetupAction;
  upstreamId: string;
}

/** On the approval page, an URL change also shows the address being replaced. */
export type PendingPlanItem = SetupPlanItem & { previousUrl?: string };

export interface PendingSetupRequest {
  id: string;
  source: string;
  requestedWith: string;
  createdAt: string;
  expiresAt: string;
  planDigest: string;
  items: PendingPlanItem[];
}

/**
 * Pending requests live only in memory: credentials of a request nobody approved
 * never reach the disk, and a restart simply drops them (the CLI is run again).
 */
interface SetupRequest {
  id: string;
  requester: SetupRequester;
  /**
   * SHA-256 of the complete submitted input, credentials included. A pending
   * request never changes; only an identical submission may reuse it.
   */
  inputDigest: string;
  status: SetupRequestStatus;
  createdAt: Date;
  /** Approval deadline while pending; removal time once decided. */
  expiresAt: Date;
  /** Includes plaintext credentials until the request is decided. */
  declaration: SetupDeclaration;
  plan: SetupPlan;
  results?: SetupResult[];
  verification?: { id: string; credentialDigest: string; expiresAt: number };
}

export type SubmitResult =
  | { status: 'unchanged'; items: SetupItemSummary[]; requestId?: string }
  | {
      status: 'pending';
      requestId: string;
      approvalUrl: string;
      expiresAt: string;
      items: SetupItemSummary[];
    };

export interface SetupServiceOptions {
  state: ConfigStateStore;
  credentialVault: CredentialVault;
  publicOrigin: string;
  onUpstreamsChanged?(): Promise<void>;
  now?: () => Date;
  probe?(input: McpConnectInput): Promise<ProbeResult>;
  claimRequest?(requester: SetupRequester, inputDigest: string): Promise<boolean>;
}

/**
 * What the admin's approval is bound to: the plan they reviewed and the request
 * it belongs to. A request never changes, and different credentials always make
 * a new request, so a digest shown for one request cannot approve another one
 * that carries the same plan with other secrets.
 */
function approvalDigest(request: { id: string; plan: SetupPlan }): string {
  return createHash('sha256')
    .update(canonicalJson({ requestId: request.id, planDigest: request.plan.digest }))
    .digest('hex');
}

function upstreamsOf(state: Readonly<ConfigState>): Upstream[] {
  return Object.values(state.upstreams).map((value) => value as unknown as Upstream);
}

function summary(items: readonly { alias: string; action: SetupAction }[]): SetupItemSummary[] {
  return items.map(({ alias, action }) => ({ alias, action }));
}

function buildUpstream(input: {
  id: UpstreamId;
  alias: string;
  desired: DesiredUpstream;
  base: Upstream | undefined;
  source: string;
  now: string;
  credentials: EncryptedCredentialEnvelope | undefined;
}): Upstream {
  const { desired, base } = input;
  return {
    id: input.id,
    alias: input.alias,
    url: desired.url,
    allowPrivateNetwork: desired.allowPrivateNetwork,
    ...(desired.displayName === undefined ? {} : { displayName: desired.displayName }),
    ...(desired.description === undefined ? {} : { description: desired.description }),
    ...(desired.metadata === undefined ? {} : { metadata: desired.metadata }),
    // The plugin is assigned in the admin UI; setup keeps whatever is there.
    ...(base?.pluginId === undefined ? {} : { pluginId: base.pluginId }),
    ...(base?.pluginVersion === undefined ? {} : { pluginVersion: base.pluginVersion }),
    ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
    managedBy: input.source,
    schemaVersion: 1,
    createdAt: base?.createdAt ?? input.now,
    updatedAt: input.now,
    version: (base?.version ?? 0) + 1,
  };
}

export class SetupService {
  readonly #options: SetupServiceOptions;
  readonly #now: () => Date;
  readonly #requests = new Map<string, SetupRequest>();
  readonly #verifying = new Set<string>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: SetupServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  /** Runs submit/approve/deny one at a time, so one request is never applied twice. */
  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #plan(declaration: SetupDeclaration, state: Readonly<ConfigState>): SetupPlan {
    return computeSetupPlan(declaration, {
      upstreams: upstreamsOf(state),
      readCredentials: (upstream) => upstream.credentials === undefined
        ? undefined
        : this.#options.credentialVault.decrypt(upstream.id, upstream.credentials),
    });
  }

  #prune(): void {
    const now = this.#now().getTime();
    for (const [id, request] of this.#requests) {
      if (request.expiresAt.getTime() <= now) this.#requests.delete(id);
    }
  }

  #get(id: string): SetupRequest {
    this.#prune();
    const request = this.#requests.get(id);
    if (request === undefined) throw new SetupError('setup.request_not_found', 404);
    return request;
  }

  #pending(id: string): SetupRequest {
    const request = this.#get(id);
    if (request.status !== 'pending') throw new SetupError('setup.request_not_found', 404);
    return request;
  }

  #decide(request: SetupRequest, status: SetupRequestStatus, results?: SetupResult[]): void {
    request.status = status;
    request.expiresAt = new Date(this.#now().getTime() + DECIDED_SETUP_RETENTION_MS);
    request.declaration = withoutCredentials(request.declaration);
    delete request.verification;
    if (results !== undefined) request.results = results;
  }

  #pendingResult(request: SetupRequest): SubmitResult {
    return {
      status: 'pending',
      requestId: request.id,
      approvalUrl: `${this.#options.publicOrigin}/setup/requests/${request.id}`,
      expiresAt: request.expiresAt.toISOString(),
      items: summary(request.plan.items),
    };
  }

  submit(input: unknown, requester: SetupRequester): Promise<SubmitResult> {
    const declaration = parseSetupDeclaration(input);
    return this.#serialize(async () => {
      const inputDigest = createHash('sha256').update(canonicalJson(declaration)).digest('hex');
      if (requester.singleUse && !await this.#options.claimRequest?.(requester, inputDigest)) {
        throw new SetupError('auth.setup_bound', 403);
      }
      const plan = this.#options.state.read((state) => this.#plan(declaration, state));
      const unchanged = plan.items.every((item) => item.action === 'unchanged');
      if (unchanged && !requester.singleUse) {
        return { status: 'unchanged', items: summary(plan.items) };
      }
      this.#prune();
      if (requester.singleUse) {
        const decided = [...this.#requests.values()].find((request) => request.requester.id === requester.id && request.inputDigest === inputDigest && request.status !== 'pending');
        if (decided !== undefined) {
          if (unchanged && decided.status === 'applied') return { status: 'unchanged', items: summary(plan.items), requestId: decided.id };
          throw new SetupError('setup.already_decided', 409);
        }
      }
      const own = [...this.#requests.values()].filter((request) =>
        request.status === 'pending' && request.requester.id === requester.id);
      const now = this.#now();
      const expiresAt = new Date(now.getTime() + SETUP_REQUEST_LIFETIME_MS);
      // Submitting exactly the same input again (for example a retried CLI run)
      // reuses its pending request instead of taking another slot. Any other
      // input, including different credentials, becomes a new request, so the
      // content behind a request the admin reviewed never changes.
      const repeated = own.find((request) =>
        request.inputDigest === inputDigest && request.plan.digest === plan.digest);
      if (repeated !== undefined) return this.#pendingResult(repeated);
      if (own.length >= MAX_PENDING_SETUP_REQUESTS_PER_TOKEN) {
        throw new SetupError('setup.too_many_pending', 429);
      }
      const request: SetupRequest = {
        id: randomUUID(),
        requester,
        inputDigest,
        status: 'pending',
        createdAt: now,
        expiresAt,
        declaration,
        plan,
      };
      this.#requests.set(request.id, request);
      if (unchanged) {
        this.#decide(request, 'applied');
        return { status: 'unchanged', items: summary(plan.items), requestId: request.id };
      }
      return this.#pendingResult(request);
    });
  }

  acknowledge(id: string, requester: SetupRequester): void {
    if (this.status(id, requester).status === 'pending') throw new SetupError('setup.not_decided', 409);
  }

  /** Progress for the requester; other tokens cannot see that the request exists. */
  status(id: string, requester: SetupRequester): {
    status: SetupRequestStatus;
    items: SetupItemSummary[];
    results?: SetupItemSummary[];
  } {
    const request = this.#get(id);
    if (request.requester.id !== requester.id) throw new SetupError('setup.request_not_found', 404);
    return {
      status: request.status,
      items: summary(request.plan.items),
      ...(request.results === undefined ? {} : { results: summary(request.results) }),
    };
  }

  /** The full plan for the admin's approval page. */
  pending(id: string): PendingSetupRequest {
    const request = this.#pending(id);
    const stored = this.#options.state.read((state) =>
      new Map(upstreamsOf(state).map((upstream) => [upstream.id as string, upstream])));
    return {
      id: request.id,
      source: request.declaration.source,
      requestedWith: request.requester.label,
      createdAt: request.createdAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      planDigest: approvalDigest(request),
      items: request.plan.items.map((item) => {
        const previousUrl = item.changes.includes('url') && item.upstreamId !== undefined
          ? stored.get(item.upstreamId)?.url
          : undefined;
        return previousUrl === undefined ? item : { ...item, previousUrl };
      }),
    };
  }

  #enteredCredentials(plan: SetupPlan, value: unknown): Map<string, UpstreamCredentials> {
    const required = new Set(plan.items
      .filter((item) => item.credentials === 'required')
      .map((item) => item.alias));
    if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      throw new SetupError('input.invalid');
    }
    const entered = new Map<string, UpstreamCredentials>();
    for (const [alias, credentials] of Object.entries((value ?? {}) as Record<string, unknown>)) {
      const item = plan.items.find((candidate) => candidate.alias === alias);
      if (item === undefined || !(item.credentials === 'required' ||
        (item.credentials === 'none' && item.action !== 'unchanged'))) throw new SetupError('setup.credentials_unexpected');
      const parsed = parseCredentials(credentials);
      const actual = [ ...(parsed.authorization === undefined ? [] : ['authorization']), ...Object.keys(parsed.headers ?? {}).map((key) => key.toLowerCase()) ].sort();
      const expected = (item.credentialFields ?? ['Authorization']).map((key) => key.toLowerCase()).sort();
      if (canonicalJson(actual) !== canonicalJson(expected)) throw new SetupError('setup.credentials_missing');
      entered.set(alias, parsed);
    }
    if ([...required].some((alias) => !entered.has(alias))) {
      throw new SetupError('setup.credentials_missing');
    }
    return entered;
  }

  /** Explicit admin-triggered network access. Never runs inside the configuration write queue. */
  async verify(id: string, input: { planDigest: unknown; credentials?: unknown }) {
    const request = this.#pending(id);
    if (input.planDigest !== approvalDigest(request)) throw new SetupError('setup.plan_mismatch', 409);
    const entered = this.#enteredCredentials(request.plan, input.credentials);
    // Snapshot the plan AND the credentials together, before any await. A later
    // edit must never send newly stored credentials to this plan's old address.
    const prepared = this.#options.state.read((state) => {
      if (this.#plan(request.declaration, state).digest !== request.plan.digest) throw new SetupError('setup.plan_stale', 409);
      return request.plan.items.filter((item) => item.action !== 'unchanged').map((item) => {
        const stored = item.upstreamId === undefined ? undefined : state.upstreams[item.upstreamId] as unknown as Upstream | undefined;
        const declared = request.declaration.upstreams.find((upstream) => upstream.alias === item.alias);
        const credentials = item.credentials === 'keep' && stored?.credentials !== undefined
          ? this.#options.credentialVault.decrypt(stored.id, stored.credentials)
          : item.credentials === 'provided' ? declared?.credentials : entered.get(item.alias);
        return { alias: item.alias, input: {
          url: new URL(item.desired.url), allowPrivateNetwork: item.desired.allowPrivateNetwork,
          ...(credentials === undefined ? {} : { credentials }),
        } };
      });
    });
    if (this.#verifying.has(id) || this.#verifying.size >= 2) throw new SetupError('setup.verification_busy', 429);
    this.#verifying.add(id);
    delete request.verification;
    try {
      const results: ({ alias: string } & ProbeResult)[] = [];
      for (let offset = 0; offset < prepared.length; offset += 4) {
        this.#pending(id);
        results.push(...await Promise.all(prepared.slice(offset, offset + 4).map(async (item) => {
          const result = await (this.#options.probe ?? probeMcp)(item.input);
          return { alias: item.alias, ...result };
        })));
      }
      if (this.#pending(id) !== request) throw new SetupError('setup.request_not_found', 404);
      const checkedAt = this.#now();
      if (results.every((item) => item.status === 'ok')) {
        request.verification = { id: randomUUID(), credentialDigest: createHash('sha256').update(canonicalJson(Object.fromEntries(entered))).digest('hex'),
          expiresAt: Math.min(checkedAt.getTime() + 120_000, request.expiresAt.getTime()) };
      }
      return { results, checkedAt: checkedAt.toISOString(),
        ...(request.verification === undefined ? {} : {
          verificationId: request.verification.id, expiresAt: new Date(request.verification.expiresAt).toISOString(),
        }) };
    } finally {
      this.#verifying.delete(id);
    }
  }

  #applyOperations(
    request: SetupRequest,
    plan: SetupPlan,
    entered: ReadonlyMap<string, UpstreamCredentials>,
    state: Readonly<ConfigState>,
  ): { operations: StateOperation[]; results: SetupResult[] } {
    const vault = this.#options.credentialVault;
    const now = this.#now().toISOString();
    const existing = new Map(upstreamsOf(state).map((upstream) => [upstream.id as string, upstream]));
    const declared = new Map(request.declaration.upstreams.map((item) => [item.alias, item]));
    const operations: StateOperation[] = [];
    const results: SetupResult[] = [];
    for (const item of plan.items) {
      if (item.action === 'unchanged') {
        results.push({ alias: item.alias, action: 'unchanged', upstreamId: item.upstreamId ?? '' });
        continue;
      }
      const upstreamId = (item.upstreamId ?? randomUUID()) as UpstreamId;
      const base = item.upstreamId === undefined ? undefined : existing.get(item.upstreamId);
      const plaintext = item.credentials === 'provided'
        ? declared.get(item.alias)?.credentials
        : item.credentials === 'required' || item.credentials === 'none'
          ? entered.get(item.alias)
          : undefined;
      const credentials = item.credentials === 'keep'
        ? base?.credentials
        : plaintext === undefined
          ? undefined
          : vault.encrypt(upstreamId, plaintext);
      const upstream = buildUpstream({
        id: upstreamId,
        alias: item.alias,
        desired: item.desired,
        base,
        source: request.declaration.source,
        now,
        credentials,
      });
      operations.push({
        type: 'record.upserted',
        collection: 'upstreams',
        id: upstreamId,
        value: upstream as unknown as JsonValue,
      });
      results.push({ alias: item.alias, action: item.action, upstreamId });
    }
    return { operations, results };
  }

  approve(
    id: string,
    input: { planDigest: string; credentials: unknown; verificationId?: unknown },
  ): Promise<{ status: 'applied'; results: SetupResult[] }> {
    return this.#serialize(async () => {
      const request = this.#pending(id);
      if (input.planDigest !== approvalDigest(request)) {
        throw new SetupError('setup.plan_mismatch', 409);
      }
      const entered = this.#enteredCredentials(request.plan, input.credentials);
      const verification = request.verification;
      const verified = verification !== undefined && verification.id === input.verificationId &&
        verification.credentialDigest === createHash('sha256').update(canonicalJson(Object.fromEntries(entered))).digest('hex');
      // The plan is recomputed and written in one step of the state queue, so a
      // concurrent change (for example an admin edit) either lands before it and
      // makes the plan stale, or lands after it and fails its own version check.
      const outcome = await this.#options.state.transact<
        { kind: 'stale' } | { kind: 'applied'; results: SetupResult[] }
      >((state) => {
        let current: SetupPlan | undefined;
        try {
          current = this.#plan(request.declaration, state);
        } catch (error) {
          if (!(error instanceof SetupError)) throw error;
        }
        if (current?.digest !== request.plan.digest) return { result: { kind: 'stale' } };
        if (!verified || request.verification !== verification || verification.expiresAt <= this.#now().getTime()) {
          throw new SetupError('setup.verification_required', 409);
        }
        const { operations, results } = this.#applyOperations(request, current, entered, state);
        return {
          ...(operations.length === 0 ? {} : { event: { type: 'records.batch', operations } }),
          result: { kind: 'applied', results },
        };
      });
      if (outcome.kind === 'stale') {
        this.#requests.delete(id);
        throw new SetupError('setup.plan_stale', 409);
      }
      this.#decide(request, 'applied', outcome.results);
      await this.#options.onUpstreamsChanged?.();
      return { status: 'applied', results: outcome.results };
    });
  }

  deny(id: string): Promise<{ status: 'denied' }> {
    return this.#serialize(async () => {
      this.#decide(this.#pending(id), 'denied');
      return { status: 'denied' };
    });
  }
}
