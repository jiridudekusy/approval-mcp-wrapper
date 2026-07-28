# Approval MCP Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-tenant, self-hosted MCP gateway that exposes token-specific remote tools, applies declarative authorization policies, supports human approval in a bilingual web UI, and journals every call.

**Architecture:** Implement a modular monolith as a TypeScript npm workspace with focused domain packages and one deployable Node.js application. Deliver the system as vertical, independently reviewable increments: durable state, policy and journal core, MCP proxy, approval/auth API, bilingual web UI, then security and operational hardening.

**Tech Stack:** Node.js 24 LTS, npm workspaces, TypeScript 7, Fastify 5, MCP TypeScript SDK 1, Zod 4, React 19, Vite 8, Vitest, fast-check, Playwright, SimpleWebAuthn 13, Node standard-library persistence and cryptography.

## Global Constraints

- English is mandatory for source code, identifiers, comments, commits, technical documentation, internal errors, reason codes, logs, audit types, schemas, and plugin contracts.
- Built-in UI workflows must support `en` and `cs`; English is the source locale and fallback.
- Target stable MCP protocol version `2025-11-25`; negotiate versions and do not adopt draft-only behavior.
- Support remote Streamable HTTP upstreams only; no `stdio` upstreams in the MVP.
- Run as one Node.js process and one writer over one persistent data directory.
- Use no native or WASM database dependency.
- Never persist raw downstream bearer tokens, recovery codes, upstream credentials, or unredacted secrets.
- Never forward a downstream token to an upstream.
- An explicit `deny` always wins; plugins cannot authorize calls.
- A disconnected, expired, interrupted, or already-started call can never be executed by a later approval.
- One `callId` can start at most one upstream tool invocation.
- Pin exact dependency versions and apply the dependency-admission policy before adding runtime packages.
- Follow TDD for every production behavior and commit after every task.

---

## File and Package Map

```text
.
├── .github/workflows/ci.yml                 # Build, test, audit, SBOM, browser checks
├── Dockerfile                               # Single production image
├── package.json                             # Workspace scripts and exact tool versions
├── package-lock.json                        # Reproducible dependency graph
├── tsconfig.base.json                       # Strict shared TypeScript settings
├── docs/
│   ├── dependencies/                        # One admission record per runtime package
│   ├── operations/                          # Deployment, backup, restore, recovery
│   └── superpowers/                         # Approved design and this plan
├── packages/
│   ├── contracts/src/                       # IDs, domain records, errors, API schemas
│   ├── state-store/src/                     # Snapshot and recovery-journal persistence
│   ├── call-journal/src/                    # Segmented MCP lifecycle journal and indexes
│   ├── policy/src/                          # Predicates, precedence, grants
│   ├── plugin-sdk/src/                      # Trusted plugin contract and generic plugin
│   ├── upstream/src/                        # MCP clients, SSRF-safe connector, tool cache
│   └── gateway/src/                         # MCP server, token auth, tool mapping, calls
├── apps/
│   ├── server/src/                          # Composition root, Admin API, auth, SSE, ops
│   └── web/src/                             # React UI, en/cs catalogs, API client
├── scripts/
│   ├── dependency-report.mjs                # Admission data and package checks
│   └── verify-language.mjs                  # English/source-locale and catalog checks
└── tests/
    ├── fixtures/                            # Fake upstream and deterministic clocks
    └── e2e/                                 # Playwright acceptance flows
```

The package boundaries are fixed by responsibility. Public imports use each
package's `index.ts`; callers do not import another package's internal files.

---

### Task 1: Workspace, Quality Gates, and Dependency Admission

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.gitignore`
- Create: `.github/workflows/ci.yml`
- Create: `scripts/dependency-report.mjs`
- Create: `scripts/verify-language.mjs`
- Create: `docs/dependencies/README.md`
- Create: `docs/dependencies/initial-runtime-packages.md`
- Test: `scripts/dependency-report.test.mjs`
- Test: `scripts/verify-language.test.mjs`

**Interfaces:**
- Produces: npm workspace names `@approval-mcp/contracts`, `@approval-mcp/state-store`, `@approval-mcp/call-journal`, `@approval-mcp/policy`, `@approval-mcp/plugin-sdk`, `@approval-mcp/upstream`, `@approval-mcp/gateway`, `@approval-mcp/server`, and `@approval-mcp/web`.
- Produces: root commands `npm test`, `npm run typecheck`, `npm run build`, `npm run audit:deps`, and `npm run verify:language`.

- [ ] **Step 1: Write failing tests for exact-version and language checks**

```js
// scripts/dependency-report.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExactVersions } from './dependency-report.mjs';

test('rejects semver ranges in runtime dependencies', () => {
  assert.deepEqual(validateExactVersions({ fastify: '^5.10.0' }), ['fastify']);
  assert.deepEqual(validateExactVersions({ fastify: '5.10.0' }), []);
});
```

```js
// scripts/verify-language.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { missingKeys } from './verify-language.mjs';

test('reports Czech catalog gaps against English source keys', () => {
  assert.deepEqual(missingKeys({ save: 'Save' }, {}), ['save']);
});
```

- [ ] **Step 2: Run the script tests and verify they fail**

Run: `node --test scripts/dependency-report.test.mjs scripts/verify-language.test.mjs`

Expected: FAIL because both scripts and exported functions do not exist.

- [ ] **Step 3: Create the workspace and minimal gate implementations**

```json
{
  "name": "approval-mcp-wrapper",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b",
    "build": "tsc -b && npm run build -w @approval-mcp/web",
    "audit:deps": "node scripts/dependency-report.mjs && npm audit --omit=dev --audit-level=high",
    "verify:language": "node scripts/verify-language.mjs",
    "verify": "npm run typecheck && npm test && npm run build && npm run audit:deps && npm run verify:language"
  }
}
```

```js
// scripts/dependency-report.mjs
export function validateExactVersions(dependencies) {
  return Object.entries(dependencies)
    .filter(([, version]) => !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    .map(([name]) => name);
}
```

```js
// scripts/verify-language.mjs
export function missingKeys(source, target) {
  return Object.keys(source).filter((key) => !(key in target)).sort();
}
```

- [ ] **Step 4: Pin and document the initial package set**

Run:

```bash
npm install --save-exact @modelcontextprotocol/sdk@1.30.0 fastify@5.10.0 @fastify/static@10.1.2 zod@4.4.3 @simplewebauthn/server@13.3.2 @simplewebauthn/browser@13.3.2 react@19.2.8 react-dom@19.2.8
npm install --save-dev --save-exact typescript@7.0.2 vite@8.1.5 @vitejs/plugin-react@6.0.4 vitest @playwright/test@1.61.1 fast-check@4.9.0 @types/node @types/react @types/react-dom
```

Record for every runtime package in `docs/dependencies/initial-runtime-packages.md`: exact version, latest release date, weekly downloads, maintainers, direct dependency count, license, advisory scan result, and why Node built-ins are insufficient. If a version has acquired a high/critical advisory since this plan was written, stop and select the newest non-vulnerable stable patch in the same major, update this plan record, and commit that documented deviation before continuing.

- [ ] **Step 5: Implement CI and complete script behavior**

CI must run `npm ci`, `npm run verify`, generate `npm sbom --sbom-format cyclonedx`, and upload the SBOM artifact. `dependency-report.mjs` must fail on non-exact runtime versions or missing admission records. `verify-language.mjs` must fail on missing English keys and print Czech gaps without failing until Task 11.

- [ ] **Step 6: Run all workspace gates**

Run: `node --test scripts/*.test.mjs && npm run audit:deps`

Expected: PASS; `npm audit` reports zero high or critical production vulnerabilities.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.workspace.ts .gitignore .github scripts docs/dependencies
git commit -m "build: establish workspace and dependency gates"
```

---

### Task 2: Domain Contracts and Durable Configuration Store

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/ids.ts`
- Create: `packages/contracts/src/entities.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/state-store/package.json`
- Create: `packages/state-store/tsconfig.json`
- Create: `packages/state-store/src/state-schema.ts`
- Create: `packages/state-store/src/file-operations.ts`
- Create: `packages/state-store/src/config-state-store.ts`
- Create: `packages/state-store/src/index.ts`
- Test: `packages/state-store/src/config-state-store.test.ts`
- Test: `packages/state-store/src/config-state-store.property.test.ts`

**Interfaces:**
- Produces: branded IDs `CallId`, `UpstreamId`, `ClientTokenId`, `PolicyId`, `GrantId`, `ApprovalId`, and `AdminId`.
- Produces: `ConfigState`, `StateEvent`, and `ConfigStateStore`.
- Produces:

```ts
interface ConfigStateStore {
  load(): Promise<Readonly<ConfigState>>;
  read<T>(select: (state: Readonly<ConfigState>) => T): T;
  mutate(event: StateEvent): Promise<Readonly<ConfigState>>;
  snapshot(): Promise<void>;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Write failing recovery and acknowledgement tests**

```ts
it('replays acknowledged events after reopening', async () => {
  const store = await createStore(tempDir);
  await store.mutate({ type: 'upstream.created', upstream });
  await store.close();

  const reopened = await createStore(tempDir);
  expect(reopened.read((state) => state.upstreams[upstream.id])).toEqual(upstream);
});

it('does not expose a mutation when journal fsync fails', async () => {
  const store = await createStore(tempDir, { fsync: async () => { throw new Error('disk'); } });
  await expect(store.mutate({ type: 'upstream.created', upstream })).rejects.toThrow('disk');
  expect(store.read((state) => state.upstreams[upstream.id])).toBeUndefined();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run packages/state-store/src/config-state-store.test.ts`

Expected: FAIL because `createStore` and domain contracts do not exist.

- [ ] **Step 3: Implement contracts and pure event reduction**

```ts
export type ConfigCollectionName =
  | 'upstreams'
  | 'clientTokens'
  | 'toolAccess'
  | 'policies'
  | 'grants'
  | 'approvals'
  | 'passkeys'
  | 'recoveryCodes'
  | 'adminSessions'
  | 'plugins'
  | 'settings';

export type StateEvent =
  | {
      type: 'record.upserted';
      collection: ConfigCollectionName;
      id: string;
      value: JsonValue;
    }
  | {
      type: 'record.deleted';
      collection: ConfigCollectionName;
      id: string;
    };

export function reduceState(state: ConfigState, event: StateEvent): ConfigState {
  switch (event.type) {
    case 'record.upserted':
      return {
        ...state,
        [event.collection]: {
          ...state[event.collection],
          [event.id]: event.value,
        },
      };
    case 'record.deleted': {
      const collection = { ...state[event.collection] };
      delete collection[event.id];
      return {
        ...state,
        [event.collection]: collection,
      };
    }
  }
}
```

Validate the complete reduced `ConfigState` with Zod before acknowledgement.
Define every entity from design sections 5–8 with `schemaVersion`, UTC ISO
timestamps, and stable reason-code fields. Store only token hashes and
encrypted credential envelopes.

- [ ] **Step 4: Implement append, fsync, atomic snapshot, and replay**

Use `node:fs/promises` only. Journal records are `{ sequence, event, checksum }`. Snapshot writes follow `open(temp) → write → sync → close → rename → sync(parent directory)`. `mutate()` appends and syncs before replacing the in-memory state. Replay rejects a sequence gap or checksum mismatch with `StateCorruptionError`.

- [ ] **Step 5: Add crash-boundary property tests**

Use `fast-check` to generate event sequences and injected failure points. Assert that reopening yields either the last fully acknowledged state or the next fully durable state, never a partially applied event.

- [ ] **Step 6: Run focused and package tests**

Run: `npx vitest run packages/state-store && npm run typecheck`

Expected: PASS with property tests covering at least 100 generated sequences.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts packages/state-store
git commit -m "feat: add durable configuration state store"
```

---

### Task 3: Redaction and Segmented Call Journal

**Files:**
- Create: `packages/call-journal/package.json`
- Create: `packages/call-journal/tsconfig.json`
- Create: `packages/call-journal/src/call-event.ts`
- Create: `packages/call-journal/src/redactor.ts`
- Create: `packages/call-journal/src/segment-writer.ts`
- Create: `packages/call-journal/src/segment-index.ts`
- Create: `packages/call-journal/src/call-journal.ts`
- Create: `packages/call-journal/src/export.ts`
- Create: `packages/call-journal/src/index.ts`
- Test: `packages/call-journal/src/redactor.test.ts`
- Test: `packages/call-journal/src/call-journal.test.ts`

**Interfaces:**
- Consumes: `CallId`, `ClientTokenId`, `UpstreamId` from `@approval-mcp/contracts`.
- Produces:

```ts
interface RedactionPlan {
  sensitivePaths: readonly string[];
  payloadLimitBytes: number;
}

interface CallJournal {
  append(event: CallEvent): Promise<void>;
  query(filter: CallFilter, cursor?: string): Promise<CallPage>;
  get(callId: CallId): Promise<CallTimeline | undefined>;
  export(filter: CallFilter, format: 'jsonl' | 'csv'): AsyncIterable<Uint8Array>;
  enforceRetention(now: Date, retentionDays: number): Promise<RetentionResult>;
}
```

- [ ] **Step 1: Write failing redaction and recovery tests**

```ts
it('redacts central and plugin-declared paths before serialization', () => {
  expect(redact(
    { authorization: 'Bearer raw', nested: { secret: 'x', body: 'ok' } },
    { sensitivePaths: ['nested.secret'], payloadLimitBytes: 4096 },
  ).value).toEqual({
    authorization: '[REDACTED]',
    nested: { secret: '[REDACTED]', body: 'ok' },
  });
});

it('ignores one incomplete final line and reports recovery metadata', async () => {
  await appendRaw(activeSegment, '{"callId":"a"}\n{"broken"');
  const result = await openJournal(tempDir);
  expect(result.recovery.truncatedLines).toBe(1);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run packages/call-journal`

Expected: FAIL because the journal and redactor do not exist.

- [ ] **Step 3: Implement copy-on-redact and payload limiting**

Central sensitive keys are case-insensitive: `authorization`, `cookie`, `token`, `access_token`, `refresh_token`, `password`, `secret`, `api_key`, and `credential`. Never mutate the input object. If serialization or a plugin path fails, return metadata-only output with reason code `redaction.failed`.

- [ ] **Step 4: Implement daily JSONL segments and rebuildable indexes**

Write lifecycle events with one `callId`; use UTC dates for filenames. Maintain an append-only compact index containing byte offsets and filter dimensions. On close, fsync both files. Rebuild the index by streaming the JSONL source. Compress only closed segments using `node:zlib`.

- [ ] **Step 5: Implement query, stable cursor, export, and retention**

Encode cursors as base64url JSON `{ segment, offset, direction }` plus a checksum. Export must stream rather than load all records. Retention deletes only closed segments older than the threshold and records deleted filenames and byte counts.

- [ ] **Step 6: Run tests**

Run: `npx vitest run packages/call-journal && npm run typecheck`

Expected: PASS, including redaction-before-write and index-rebuild tests.

- [ ] **Step 7: Commit**

```bash
git add packages/call-journal packages/contracts
git commit -m "feat: journal redacted MCP call lifecycles"
```

---

### Task 4: Declarative Policy Engine and Grants

**Files:**
- Create: `packages/policy/package.json`
- Create: `packages/policy/tsconfig.json`
- Create: `packages/policy/src/predicate.ts`
- Create: `packages/policy/src/canonical-request.ts`
- Create: `packages/policy/src/grants.ts`
- Create: `packages/policy/src/evaluate.ts`
- Create: `packages/policy/src/index.ts`
- Test: `packages/policy/src/evaluate.test.ts`
- Test: `packages/policy/src/evaluate.property.test.ts`

**Interfaces:**
- Consumes: `Policy`, `Grant`, branded IDs from `@approval-mcp/contracts`.
- Produces:

```ts
type PolicyDecision =
  | { outcome: 'allow'; reasonCode: string; policyId?: PolicyId; grantId?: GrantId }
  | { outcome: 'deny'; reasonCode: string; policyId?: PolicyId }
  | { outcome: 'require_approval'; reasonCode: string; policyId: PolicyId };

function evaluatePolicy(input: PolicyInput): PolicyDecision;
function canonicalRequestHash(input: CanonicalRequest): string;
```

- [ ] **Step 1: Write the precedence matrix as failing tests**

```ts
it.each([
  ['explicit deny beats a matching grant', denyPolicy, matchingGrant, 'deny'],
  ['matching grant beats allow and approval', approvalPolicy, matchingGrant, 'allow'],
  ['approval applies without a grant', approvalPolicy, undefined, 'require_approval'],
  ['missing policy fails closed', undefined, undefined, 'deny'],
])('%s', (_name, policy, grant, expected) => {
  expect(evaluatePolicy(makeInput({ policy, grant })).outcome).toBe(expected);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run packages/policy/src/evaluate.test.ts`

Expected: FAIL because `evaluatePolicy` does not exist.

- [ ] **Step 3: Implement predicates and canonical hashing**

Implement JSON-pointer field lookup and only `equals`, `in`, `startsWith`, and `exists`. Canonical JSON recursively sorts object keys, preserves array order, rejects non-JSON values, and hashes `clientTokenId`, `upstreamId`, `toolName`, and arguments with SHA-256.

- [ ] **Step 4: Implement precedence, expiry, revocation, and normalization-version checks**

Return stable English reason codes such as `policy.explicit_deny`, `tool.hidden`, `grant.matched`, `policy.allowed`, `approval.required`, and `policy.implicit_deny`.

- [ ] **Step 5: Add property tests**

Generate policies, grants, and contexts. Assert that adding an explicit matching deny can never change a result to `allow`, expired grants never match, and canonical hashes are invariant to object-key insertion order.

- [ ] **Step 6: Run tests**

Run: `npx vitest run packages/policy && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/policy
git commit -m "feat: evaluate declarative tool policies"
```

---

### Task 5: Trusted Plugin SDK and Generic Presentation

**Files:**
- Create: `packages/plugin-sdk/package.json`
- Create: `packages/plugin-sdk/tsconfig.json`
- Create: `packages/plugin-sdk/src/contracts.ts`
- Create: `packages/plugin-sdk/src/validate-output.ts`
- Create: `packages/plugin-sdk/src/generic-plugin.ts`
- Create: `packages/plugin-sdk/src/plugin-registry.ts`
- Create: `packages/plugin-sdk/src/index.ts`
- Test: `packages/plugin-sdk/src/plugin-registry.test.ts`
- Test: `packages/plugin-sdk/src/localization.test.ts`

**Interfaces:**
- Produces:

```ts
interface ApprovalPlugin {
  readonly id: string;
  readonly version: string;
  readonly normalizationVersion: number;
  describe(input: PluginCallInput): Promise<PluginCallDescription>;
}

interface PluginCallDescription {
  normalizedContext: Readonly<Record<string, JsonValue>>;
  sensitivePaths: readonly string[];
  title: LocalizedMessage;
  sections: readonly ApprovalSection[];
  proposedScopes: readonly ProposedGrantScope[];
}
```

- [ ] **Step 1: Write failing contract and fallback tests**

Test that a missing English fallback rejects plugin output, missing Czech text resolves to English, invalid sensitive paths reject output, and an exception returns the generic descriptor without authorizing anything.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run packages/plugin-sdk`

Expected: FAIL because plugin contracts do not exist.

- [ ] **Step 3: Implement Zod contracts and locale resolution**

`LocalizedMessage` is `{ key, params, fallback: { en, cs? } }`. Parameters are JSON scalars only. The browser receives descriptors, not HTML or executable code.

- [ ] **Step 4: Implement registry and generic fallback**

Registry lookup is by pinned plugin ID and exact version. Give plugins only tool metadata and call arguments; never pass credentials, bearer tokens, network clients, or the policy decision.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run packages/plugin-sdk && npm run typecheck`

```bash
git add packages/plugin-sdk
git commit -m "feat: define trusted approval plugin contract"
```

---

### Task 6: SSRF-Safe Upstream Registry and MCP Client

**Files:**
- Create: `packages/upstream/package.json`
- Create: `packages/upstream/tsconfig.json`
- Create: `packages/upstream/src/address-policy.ts`
- Create: `packages/upstream/src/credential-envelope.ts`
- Create: `packages/upstream/src/mcp-client.ts`
- Create: `packages/upstream/src/upstream-registry.ts`
- Create: `packages/upstream/src/index.ts`
- Create: `tests/fixtures/fake-upstream.ts`
- Test: `packages/upstream/src/address-policy.test.ts`
- Test: `packages/upstream/src/upstream-registry.test.ts`

**Interfaces:**
- Consumes: `Upstream`, encrypted credential envelope, `CallId`.
- Produces:

```ts
interface UpstreamRegistry {
  refresh(upstreamId: UpstreamId): Promise<ToolCatalog>;
  getCatalog(upstreamId: UpstreamId): ToolCatalog | undefined;
  call(input: UpstreamCall): Promise<CallToolResult>;
  health(upstreamId: UpstreamId): UpstreamHealth;
}

interface AddressPolicy {
  assertAllowed(url: URL, resolved: readonly ResolvedAddress[], rules: NetworkRules): void;
}
```

- [ ] **Step 1: Write failing address-policy and MCP tests**

Cover loopback, link-local, RFC1918, IPv4-mapped IPv6, cloud metadata addresses, redirect to a blocked address, DNS answer changes, explicit per-upstream private-range allow, tool discovery, and credentials separated from downstream auth.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run packages/upstream`

Expected: FAIL because registry classes do not exist.

- [ ] **Step 3: Implement credential encryption**

Use AES-256-GCM with a random 96-bit nonce and authenticated metadata containing upstream ID and envelope version. Load the 32-byte master key from `APPROVAL_MCP_MASTER_KEY`; never log it or return decrypted credentials outside the connection adapter.

- [ ] **Step 4: Implement address checks at configuration, redirect, and connect time**

Resolve all DNS answers and reject if any is outside the configured policy. Re-resolve before connection. Use a connector that pins the validated address while preserving the original hostname for TLS verification.

- [ ] **Step 5: Implement MCP Streamable HTTP discovery and calls**

Use the official SDK, target protocol `2025-11-25`, cache deterministic catalogs, expose health, and emit catalog-change events. Do not add legacy HTTP+SSE fallback in the MVP.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run packages/upstream && npm run typecheck`

```bash
git add packages/upstream tests/fixtures
git commit -m "feat: connect SSRF-safe remote MCP upstreams"
```

---

### Task 7: Token Authentication and MCP Gateway

**Files:**
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/tsconfig.json`
- Create: `packages/gateway/src/token-service.ts`
- Create: `packages/gateway/src/tool-name.ts`
- Create: `packages/gateway/src/catalog.ts`
- Create: `packages/gateway/src/call-coordinator.ts`
- Create: `packages/gateway/src/mcp-server.ts`
- Create: `packages/gateway/src/index.ts`
- Test: `packages/gateway/src/token-service.test.ts`
- Test: `packages/gateway/src/mcp-server.test.ts`

**Interfaces:**
- Consumes: state store, call journal, policy engine, plugin registry, upstream registry.
- Produces:

```ts
interface CallCoordinator {
  call(input: AuthorizedToolCall, signal: AbortSignal): Promise<CallToolResult>;
}

interface TokenService {
  create(label: string): Promise<{ record: ClientTokenRecord; plaintext: string }>;
  authenticate(plaintext: string): Promise<ClientTokenRecord | undefined>;
  revoke(id: ClientTokenId): Promise<void>;
}
```

- [ ] **Step 1: Write failing token and catalog-isolation tests**

Test that plaintext is returned once, only a scrypt hash is stored, revocation is immediate, two tokens receive different deterministic `tools/list`, guessed hidden tools return the same error as unknown tools, and incoming `Origin` is validated.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run packages/gateway`

Expected: FAIL because gateway services do not exist.

- [ ] **Step 3: Implement token generation and hashing**

Generate 32 random bytes and encode base64url with prefix `amcp_`. Store scrypt parameters, salt, and derived key; compare with `timingSafeEqual`. Never persist or log plaintext.

- [ ] **Step 4: Implement stable tool mapping and filtered catalogs**

Validate upstream aliases and tool names before composing `alias__tool`. Reject ambiguous names at upstream registration. Sort by public tool name and emit list-changed only to affected authenticated sessions.

- [ ] **Step 5: Implement MCP server transport and call handoff**

Use the official Streamable HTTP server transport. Authenticate every request, negotiate protocol versions, validate Origin, and pass an `AbortSignal` tied to disconnect/timeout into `CallCoordinator`.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run packages/gateway && npm run typecheck`

```bash
git add packages/gateway
git commit -m "feat: expose token-scoped MCP tools"
```

---

### Task 8: Approval State Machine and At-Most-Once Execution

**Files:**
- Create: `packages/contracts/src/approval-state.ts`
- Create: `packages/gateway/src/approval-orchestrator.ts`
- Create: `packages/gateway/src/pending-call-registry.ts`
- Modify: `packages/gateway/src/call-coordinator.ts`
- Test: `packages/gateway/src/approval-orchestrator.test.ts`
- Test: `packages/gateway/src/call-coordinator.integration.test.ts`

**Interfaces:**
- Produces:

```ts
type ApprovalDecision =
  | { action: 'deny' }
  | { action: 'allow_once' }
  | { action: 'allow_until'; expiresAt: string; predicate: Predicate }
  | { action: 'allow_forever'; predicate: Predicate };

interface ApprovalOrchestrator {
  request(input: ApprovalRequestInput, signal: AbortSignal): Promise<ApprovalOutcome>;
  decide(id: ApprovalId, decision: ApprovalDecision, actor: AdminId): Promise<Approval>;
  interruptAll(reasonCode: 'server.restarted'): Promise<void>;
}
```

- [ ] **Step 1: Write the state-transition table as failing tests**

Cover `pending → approved/denied/expired/abandoned/interrupted`, reject every transition from a terminal state, reject a changed request hash, and test two concurrent approvals where exactly one succeeds.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run packages/gateway/src/approval-orchestrator.test.ts`

Expected: FAIL because the state machine does not exist.

- [ ] **Step 3: Implement pending-call registration and cancellation**

Keep only resolvers and abort handlers in memory; persist approval records in the state store. Abort changes `pending` to `abandoned` before removing the resolver. Startup changes every persisted `pending` approval to `interrupted`.

- [ ] **Step 4: Implement atomic decision and grant creation**

Within one serialized state mutation, revalidate hash, current explicit denies, expiry, and terminal state; create a one-time/time/permanent grant if selected; transition to approved; then resolve the waiter. Execution acquires a one-way `authorized → executing` transition before calling upstream.

- [ ] **Step 5: Integrate complete journaling**

Append `call.received`, `policy.decided`, `approval.requested`, `approval.decided`, `upstream.started`, and exactly one terminal event. Redact before every payload-bearing append.

- [ ] **Step 6: Run race and integration tests**

Run: `npx vitest run packages/gateway`

Expected: PASS; the fake upstream invocation counter equals one in all approval races.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts packages/gateway
git commit -m "feat: orchestrate at-most-once human approvals"
```

---

### Task 9: Server Composition, Sessions, Passkeys, and Recovery

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/session-store.ts`
- Create: `apps/server/src/passkey-service.ts`
- Create: `apps/server/src/recovery-service.ts`
- Create: `apps/server/src/auth-routes.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/main.ts`
- Test: `apps/server/src/passkey-service.test.ts`
- Test: `apps/server/src/auth-routes.test.ts`

**Interfaces:**
- Consumes: all server-side packages created so far.
- Produces: Fastify app and authenticated admin session.
- Produces routes:
  - `POST /api/auth/bootstrap/options`
  - `POST /api/auth/bootstrap/verify`
  - `POST /api/auth/login/options`
  - `POST /api/auth/login/verify`
  - `POST /api/auth/recovery`
  - `POST /api/auth/logout`

- [ ] **Step 1: Write failing bootstrap, login, replay, and recovery tests**

Test one-time bootstrap, RP ID/origin binding, challenge expiry, sign-counter handling, Secure/HttpOnly/SameSite cookie attributes, CSRF token requirement, one-time recovery codes, and audit events without credential material.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run apps/server/src/auth-routes.test.ts`

Expected: FAIL because the server app and auth services do not exist.

- [ ] **Step 3: Implement configuration validation and composition root**

Require `APPROVAL_MCP_PUBLIC_URL`, `APPROVAL_MCP_DATA_DIR`, `APPROVAL_MCP_MASTER_KEY`, and production HTTPS. Permit HTTP only when hostname is exactly `localhost` or `127.0.0.1`.

- [ ] **Step 4: Implement passkey ceremony and sessions**

Use SimpleWebAuthn server APIs with challenges stored in short-lived, single-use state records. Store credential IDs, public keys, counters, transports, and timestamps only. Sessions are random 32-byte opaque tokens stored as hashes and sent in Secure, HttpOnly, SameSite=Strict cookies.

- [ ] **Step 5: Implement recovery codes**

Generate ten printable one-time codes, return plaintext once, store scrypt hashes, revoke a used code atomically, invalidate active sessions after recovery, and require registering a replacement passkey.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run apps/server && npm run typecheck`

```bash
git add apps/server
git commit -m "feat: authenticate administrators with passkeys"
```

---

### Task 10: Admin API and Approval SSE

**Files:**
- Create: `apps/server/src/admin/authorization.ts`
- Create: `apps/server/src/admin/upstream-routes.ts`
- Create: `apps/server/src/admin/token-routes.ts`
- Create: `apps/server/src/admin/policy-routes.ts`
- Create: `apps/server/src/admin/approval-routes.ts`
- Create: `apps/server/src/admin/history-routes.ts`
- Create: `apps/server/src/admin/system-routes.ts`
- Create: `apps/server/src/admin/sse-broker.ts`
- Test: `apps/server/src/admin/admin-api.test.ts`
- Test: `apps/server/src/admin/sse-broker.test.ts`

**Interfaces:**
- Produces JSON APIs under `/api/admin`.
- Produces `GET /api/admin/approvals/events` as authenticated SSE.
- Uses stable error shape:

```ts
interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: JsonValue };
}
```

- [ ] **Step 1: Write failing authorization, CRUD, secret, and SSE tests**

Verify unauthenticated rejection, CSRF on mutations, one-time token display,
masked credentials, conditional-update version conflicts, approval decision
validation, SSE replay via `Last-Event-ID`, and disconnect cleanup.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run apps/server/src/admin`

Expected: FAIL because admin routes do not exist.

- [ ] **Step 3: Implement schema-first route handlers**

Use Zod request/response contracts shared through `@approval-mcp/contracts`.
Never serialize hashes or credential ciphertext. Use optimistic `version`
fields for configuration updates and return `state.version_conflict` on stale
writes.

- [ ] **Step 4: Implement approval event broker**

Publish persisted approval summaries with monotonic event IDs. On reconnect,
replay events newer than `Last-Event-ID` from state and then subscribe live.
Send a comment heartbeat every 20 seconds.

- [ ] **Step 5: Implement history streaming**

Map journal filters and cursors directly to the call journal. Stream exports
with `Content-Disposition`; never buffer an entire export.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run apps/server && npm run typecheck`

```bash
git add apps/server/src/admin packages/contracts
git commit -m "feat: add authenticated administration API"
```

---

### Task 11: Bilingual Web Shell and Authentication

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/i18n/en.ts`
- Create: `apps/web/src/i18n/cs.ts`
- Create: `apps/web/src/i18n/i18n.tsx`
- Create: `apps/web/src/components/language-switch.tsx`
- Create: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/pages/login.tsx`
- Create: `apps/web/src/styles.css`
- Test: `apps/web/src/i18n/i18n.test.ts`
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `/api/auth/*` and `/api/admin/*`.
- Produces: `useI18n(): { locale: 'en' | 'cs'; t(key, params): string; setLocale(locale): void }`.

- [ ] **Step 1: Write failing locale and login tests**

Test browser preference selection, stored override, English fallback, switching
without reload, equivalent login controls in both locales, and passkey calls
through `@simplewebauthn/browser`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run apps/web/src/i18n && npx playwright test tests/e2e/auth.spec.ts`

Expected: FAIL because the web app does not exist.

- [ ] **Step 3: Implement typed message catalogs**

Derive `MessageKey` from the English catalog. Czech must satisfy
`Record<MessageKey, string>`. Store locale as `approval-mcp.locale`; explicit
selection wins over browser preference. Use `Intl.DateTimeFormat` and
`Intl.NumberFormat` with the selected locale.

- [ ] **Step 4: Implement responsive shell and passkey login**

Provide navigation for Inbox, History, Access, Upstreams, and System. At widths
below 720px use a bottom navigation pattern. Keep visible focus, semantic
headings, and WCAG AA contrast.

- [ ] **Step 5: Make language verification strict**

Change `verify-language.mjs` so missing Czech built-in keys fail CI. Plugin
runtime content still falls back to English at runtime.

- [ ] **Step 6: Run tests and commit**

Run: `npm run verify:language && npx vitest run apps/web && npx playwright test tests/e2e/auth.spec.ts`

```bash
git add apps/web tests/e2e/auth.spec.ts scripts/verify-language.mjs
git commit -m "feat: add bilingual passkey web shell"
```

---

### Task 12: Mobile Approval Inbox and Decision UX

**Files:**
- Create: `apps/web/src/pages/inbox.tsx`
- Create: `apps/web/src/components/approval-card.tsx`
- Create: `apps/web/src/components/approval-detail.tsx`
- Create: `apps/web/src/components/grant-scope-form.tsx`
- Create: `apps/web/src/components/approval-view-model.ts`
- Create: `apps/web/src/hooks/use-approval-events.ts`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/i18n/cs.ts`
- Test: `apps/web/src/components/approval-view-model.test.ts`
- Test: `tests/e2e/approval-flow.spec.ts`

**Interfaces:**
- Consumes: approval descriptors and `/api/admin/approvals/events`.
- Produces: deny, allow-once, allow-until, and allow-forever decisions.

- [ ] **Step 1: Write failing bilingual approval-flow tests**

Use a fake upstream and a real waiting MCP call. Assert the call appears in
Inbox, redacted fields stay hidden, plugin sections render, each grant mode
submits the exact predicate, the caller resumes after approval, Czech switch
changes built-in text, and disconnect disables decisions.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx playwright test tests/e2e/approval-flow.spec.ts`

Expected: FAIL because Inbox components do not exist.

- [ ] **Step 3: Implement resilient SSE subscription**

Reconnect with exponential backoff capped at 15 seconds and preserve
`Last-Event-ID`. Always refresh the pending list after reconnect to close gaps.

- [ ] **Step 4: Implement approval detail and explicit scope confirmation**

Show token label, upstream, tool, age, risk sections, redacted arguments, and
the exact generated predicate. Permanent approval requires a second explicit
confirmation; deny and allow-once remain one action.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run apps/web && npx playwright test tests/e2e/approval-flow.spec.ts`

```bash
git add apps/web tests/e2e/approval-flow.spec.ts
git commit -m "feat: approve MCP calls from mobile inbox"
```

---

### Task 13: Upstream, Token, Policy, Grant, and Plugin Administration

**Files:**
- Create: `apps/web/src/pages/upstreams.tsx`
- Create: `apps/web/src/pages/access.tsx`
- Create: `apps/web/src/pages/system.tsx`
- Create: `apps/web/src/components/upstream-form.tsx`
- Create: `apps/web/src/components/token-form.tsx`
- Create: `apps/web/src/components/policy-editor.tsx`
- Create: `apps/web/src/components/predicate-builder.tsx`
- Create: `apps/web/src/components/plugin-list.tsx`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/i18n/cs.ts`
- Test: `tests/e2e/admin-config.spec.ts`

**Interfaces:**
- Consumes: admin CRUD APIs from Task 10.
- Produces: complete web management for MVP configuration.

- [ ] **Step 1: Write failing admin workflow tests**

Test adding a public upstream, explicit warning and allow for a private-range
upstream, discovering tools, generating a token shown once, assigning visible
tools, building each predicate operator, setting policy outcomes, revoking a
grant, pinning a plugin version, and detecting stale update conflicts.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx playwright test tests/e2e/admin-config.spec.ts`

Expected: FAIL because management pages do not exist.

- [ ] **Step 3: Implement upstream and token screens**

Never put credentials or generated tokens into query strings, localStorage, or
analytics. The one-time token modal cannot be reopened after dismissal.
Changing an upstream alias requires typing the new alias to confirm the
breaking public-tool-name change.

- [ ] **Step 4: Implement policy and predicate builder**

Render only the four supported operators. Display the normalized context path,
typed comparison value, outcome, precedence explanation, and an English/Czech
preview of the rule.

- [ ] **Step 5: Implement system and plugin screens**

Show exact plugin versions, compatibility, English fallback status, passkeys,
recovery regeneration, retention, and runtime health. Plugin installation is
from an administrator-configured local allowlist; arbitrary npm install from
the web UI is not allowed.

- [ ] **Step 6: Run tests and commit**

Run: `npm run verify:language && npx playwright test tests/e2e/admin-config.spec.ts`

```bash
git add apps/web tests/e2e/admin-config.spec.ts
git commit -m "feat: manage MCP access from the web"
```

---

### Task 14: History, Export, Retention, and Rule Creation

**Files:**
- Create: `apps/web/src/pages/history.tsx`
- Create: `apps/web/src/components/history-filter.tsx`
- Create: `apps/web/src/components/call-timeline.tsx`
- Create: `apps/web/src/components/create-rule-from-call.tsx`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/i18n/cs.ts`
- Test: `tests/e2e/history.spec.ts`
- Test: `apps/server/src/admin/history-routes.integration.test.ts`

**Interfaces:**
- Consumes: cursor history API, streamed exports, and policy/grant APIs.
- Produces: the complete MVP "work with call logs" workflow.

- [ ] **Step 1: Write failing history tests**

Generate calls with different times, tokens, upstreams, tools, decisions, and
results. Test combined filters, stable pagination during concurrent appends,
localized detail rendering, redaction, JSONL/CSV download, retention deletion,
and creating a constrained policy from one call.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run apps/server/src/admin/history-routes.integration.test.ts && npx playwright test tests/e2e/history.spec.ts`

Expected: FAIL because History UI does not exist.

- [ ] **Step 3: Implement filters, timeline, and streaming download**

Keep filters in the URL but exclude payload values and secrets. Display each
journal event with localized known reason codes and preserve unknown code plus
English source message.

- [ ] **Step 4: Implement rule creation from a call**

Start from the plugin-proposed scope, show the exact predicate, require outcome
selection and duration, and submit through the same policy/grant API as Access.
Never infer a broader scope than the selected proposal.

- [ ] **Step 5: Run tests and commit**

Run: `npm run verify:language && npx vitest run apps/server apps/web && npx playwright test tests/e2e/history.spec.ts`

```bash
git add apps/web apps/server/src/admin tests/e2e/history.spec.ts
git commit -m "feat: inspect and export MCP call history"
```

---

### Task 15: Deployment, Backup, Recovery, and Security Hardening

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `apps/server/src/operations/health.ts`
- Create: `apps/server/src/operations/backup.ts`
- Create: `apps/server/src/operations/restore.ts`
- Create: `apps/server/src/operations/retention-job.ts`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/backup-and-restore.md`
- Create: `docs/operations/disaster-recovery.md`
- Test: `apps/server/src/operations/backup.test.ts`
- Test: `tests/e2e/security.spec.ts`

**Interfaces:**
- Produces: `/health/live`, `/health/ready`.
- Produces CLI commands `server backup --output <path>` and
  `server restore --input <path> --dry-run`.

- [ ] **Step 1: Write failing operational and security tests**

Cover missing master key, unwritable data directory, corrupt snapshot,
consistent backup while calls append, dry-run restore, restore checksum
failure, Origin rejection, CSRF, session fixation, private-address SSRF,
redirect SSRF, DNS rebinding simulation, log token leakage, and plugin output
containing script markup.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run apps/server/src/operations && npx playwright test tests/e2e/security.spec.ts`

Expected: FAIL because operations and production configuration do not exist.

- [ ] **Step 3: Implement readiness and scheduled retention**

Liveness only reports process responsiveness. Readiness checks loaded valid
state, master key, writable durable storage, and no fatal recovery error.
Upstream health is reported separately and does not fail global readiness.

- [ ] **Step 4: Implement consistent backup and verified restore**

Acquire the state mutation queue briefly, create a state snapshot, record the
call-journal closed-segment boundary, then release it and stream selected files
into a temporary backup directory using `node:fs/promises`. Record SHA-256
checksums in `manifest.json`, fsync the files and directory, then atomically
rename the directory to the requested output path. Dry-run restore validates
every checksum and replays state into a temporary directory without replacing
live data.

- [ ] **Step 5: Build the production image**

Use a pinned Node 24 slim image by digest, non-root user, read-only application
files, declared data volume, production dependencies only, and built web assets
served through Fastify. Document reverse-proxy HTTPS and WebAuthn RP settings.

- [ ] **Step 6: Run security and container checks**

Run:

```bash
npm run verify
npx playwright test tests/e2e/security.spec.ts
docker build -t approval-mcp-wrapper:test .
docker run --rm approval-mcp-wrapper:test node --version
```

Expected: all checks pass; Node reports major version 24.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore apps/server/src/operations docs/operations tests/e2e/security.spec.ts
git commit -m "feat: harden deployment and recovery"
```

---

### Task 16: Full Acceptance Suite and Release Candidate

**Files:**
- Create: `tests/e2e/mvp-acceptance.spec.ts`
- Create: `tests/fixtures/signal-approval-plugin.ts`
- Create: `docs/operations/configuration-reference.md`
- Create: `README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: the complete system.
- Produces: one executable MVP and one automated test for every design
  acceptance criterion.

- [ ] **Step 1: Write the full failing acceptance scenario**

The scenario must:

1. bootstrap an administrator passkey,
2. add two fake remote MCP upstreams,
3. create two client tokens with different catalogs,
4. deny one call,
5. approve one call from the Czech mobile UI,
6. create a permanent `group_id` grant,
7. reuse it only for the matching group,
8. abandon another waiting call by disconnecting,
9. race two approval decisions and observe one upstream execution,
10. find and export all calls from History,
11. scan persistent files for known plaintext tokens and credentials,
12. crash and reopen the state store,
13. switch back to English and verify persisted preference.

- [ ] **Step 2: Run the acceptance scenario as a release verification**

Run: `npx playwright test tests/e2e/mvp-acceptance.spec.ts`

Expected: PASS. If it fails, the failing assertion identifies an integration
gap; add a focused regression test in the owning package before changing
production code.

- [ ] **Step 3: Resolve any integration gaps exposed by the acceptance test**

Keep fixes inside the owning focused module. Do not add features outside the
approved design. For each failure, reproduce it in the smallest owning-package
test, observe that test fail, implement the minimal correction, rerun the
focused test, and then rerun the full acceptance scenario. Skip this step when
Step 2 passes.

- [ ] **Step 4: Complete operator documentation**

`README.md` must include architecture summary, prerequisites, local start,
production deployment, first passkey bootstrap, upstream creation, token
creation, policy examples, backup, restore, and security-reporting guidance.
`configuration-reference.md` must list every environment variable, default,
validation rule, and whether it is secret.

- [ ] **Step 5: Run the full release gate**

Run:

```bash
npm ci
npm run verify
npx playwright test
docker build -t approval-mcp-wrapper:rc .
```

Expected: zero failed tests, zero type errors, zero build errors, zero high or
critical production dependency advisories, complete English/Czech built-in
catalogs, and a successful image build.

- [ ] **Step 6: Inspect the production dependency and artifact surfaces**

Run:

```bash
npm ls --omit=dev --all
npm sbom --sbom-format cyclonedx > /tmp/approval-mcp-wrapper-sbom.json
docker history approval-mcp-wrapper:rc
```

Verify that no native or WASM database package exists, no development secrets
are copied into image layers, and every runtime dependency has an admission
record.

- [ ] **Step 7: Commit the release candidate**

```bash
git add README.md docs/operations tests .github/workflows/ci.yml package.json package-lock.json
git commit -m "test: verify approval MCP wrapper MVP"
```

---

## Execution Order and Review Gates

Execute Tasks 1–16 in order. Tasks 1–15 are reviewer gates and must have:

1. a failing test observed before production implementation,
2. focused tests passing,
3. `npm run typecheck` passing,
4. a diff review against that task's interfaces and global constraints,
5. its own commit.

Task 16 is the release-verification gate and need not manufacture a new failing
test when the preceding TDD increments already satisfy its assertions. After
Tasks 4, 8, 12, and 16, also run the complete `npm run verify` gate. Do not
defer a failing gate to a later task.

## Definition of Done

Implementation is complete only when the Task 16 release gate passes from a
fresh `npm ci`, the Docker image builds, all fourteen design acceptance
criteria have automated coverage, the dependency admission records match the
lockfile, and the design document contains no unimplemented MVP requirement.
