# Approval MCP Wrapper — MVP Design

Date: 2026-07-28
Status: Approved, amended during written-spec review

## 1. Goal

Build a single-tenant, self-hosted MCP gateway that aggregates any number of
remote MCP servers and exposes their tools to agents according to the
permissions of each client token.

Before every tool call, the gateway must centrally decide whether the call is:

- allowed,
- denied,
- or subject to human approval in the web interface.

An approval can apply only to the pending call, until a specified time, or
indefinitely. Time-limited and permanent grants can include conditions over
tool arguments, such as restricting a Signal tool to one group.

The MVP is intended for one operator's private AI chain. It prioritizes simple
deployment, auditability, safe defaults, and recoverability over horizontal
scale.

## 2. Language Policy

English is the canonical engineering language for the project:

- source code, identifiers, and code comments,
- commit messages,
- technical documentation,
- configuration keys and schemas,
- internal errors, reason codes, logs, and audit event types,
- plugin API names and contracts.

The web UI supports English and Czech through locale identifiers `en` and `cs`.
English is the source locale and fallback. On first use, the UI may select
Czech when the browser prefers it; an explicit language switch is always
available and its selection is persisted for the administrator.

Persisted records contain language-neutral reason codes, structured values,
and translation message keys rather than rendered text. This allows historical
events to be rendered in either language later. Plugin presentation descriptors
use message keys and localized parameter values. Every plugin-supplied message
must include an English fallback. Raw names and descriptions received from an
upstream MCP server are source data and are not automatically translated.

## 3. MVP Scope

The MVP includes:

- one self-hosted TypeScript/Node.js server,
- remote upstream MCP servers over Streamable HTTP,
- one credential set per upstream,
- multiple downstream client bearer tokens,
- a separate visible-tool set and policy set for each client token,
- stable public tool names in the `server__tool` format,
- web management of upstreams, tokens, policies, grants, plugins, and audit,
- a mobile-friendly web approval inbox,
- a built-in administrator identity using passkeys/WebAuthn,
- trusted server-side plugins with declarative presentation output,
- a detailed journal of every MCP call,
- history filtering, export, and retention controls,
- English and Czech UI locales with a language switch.

The following are outside the MVP:

- multi-tenant operation,
- local `stdio` MCP servers,
- multiple upstream credentials for one server,
- plugin-provided executable frontend components,
- a mobile application and push notifications,
- automatic call replay,
- automatic retries of mutating tools,
- horizontal scaling and Node cluster mode,
- a full OAuth 2.1 authorization-server implementation for downstream clients,
- automatic translation of upstream-provided content.

## 4. Protocol Compatibility

The first implementation targets the stable MCP specification `2025-11-25`
and uses protocol version negotiation. Draft changes are not adopted until
they become stable.

The gateway implements both the server and client sides of Streamable HTTP. It
must:

- accept JSON-RPC requests on one MCP endpoint,
- implement initialization and capability negotiation,
- validate `Origin` on inbound HTTP connections,
- support `tools/list` and `tools/call`,
- return tools in deterministic order,
- filter `tools/list` by the authorization presented with the request,
- propagate `notifications/tools/list_changed` when the active client's
  visible tool set changes and negotiated capabilities permit it,
- never forward a downstream client token to an upstream server.

The MVP uses private static bearer tokens. This is a deliberate authentication
strategy for a private installation, not a full MCP OAuth 2.1 flow. Transport
authentication is isolated behind an interface so OAuth can be added later
without changing the policy engine.

References:

- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

## 5. Architecture

The system is a modular monolith running in one Node.js process. Modules have
explicit interfaces and cannot bypass each other's responsibilities.

### 5.1 MCP Gateway

- Authenticates the client bearer token.
- Implements the MCP lifecycle, `tools/list`, and `tools/call`.
- Resolves `server__tool` to an upstream and its original tool name.
- Validates input against the upstream JSON Schema.
- Creates the internal `callId`.
- Never calls an upstream without an explicit policy-engine result.

### 5.2 Upstream Registry

- Stores the alias, URL, health, and one credential set for each upstream.
- Loads and caches upstream tool definitions.
- Handles reconnection and upstream tool-list changes.
- Executes a call only after authorization has completed.

An upstream alias is stable and unique. Changing it is a breaking change to
public tool names, and the UI must warn before applying the change.

### 5.3 Policy Engine

The policy engine is a deterministic, pure domain service. Its input contains:

- client-token identity,
- upstream and tool identity,
- original and normalized arguments,
- active policies and grants,
- current time.

It returns `allow`, `deny`, or `require_approval` with a machine-readable reason
code. It does not execute user code and has no network access.

### 5.4 Approval Orchestrator

- Creates and persists approval requests.
- Associates a waiting HTTP/MCP request with its approval.
- Atomically accepts at most one decision.
- Revalidates the request and current policy after approval.
- Guarantees at-most-once upstream execution for one `callId`.
- Prevents execution after the client disconnects or the request expires.

### 5.5 Plugin Runtime

Plugins are explicitly installed, trusted TypeScript code running on the
server. A plugin can:

- normalize arguments into the generic policy context,
- identify sensitive values for redaction,
- create a human-readable request description,
- return declarative sections, risks, and highlights for approval UI,
- propose constrained grants such as "only this group",
- resolve display names through bounded, host-mediated, read-only resources on
  the same upstream,
- provide English and Czech translations for its own message keys.

A plugin cannot:

- return the final authorization decision or bypass the policy engine,
- access raw upstream credentials,
- call upstream tools, access arbitrary resources, or make network requests
  itself,
- deliver executable JavaScript to the browser.

Plugin output is validated against a versioned contract. A plugin failure
causes a safe generic approval view or a fail-closed result, never automatic
authorization. Missing Czech strings fall back to English.

### 5.6 Admin/Auth API and Web UI

The Admin API handles passkeys, sessions, recovery, configuration, approvals,
and history. The web application uses the same API and has five areas:

- Inbox,
- History,
- Access,
- Upstreams,
- System.

The Inbox updates through SSE. Future push notifications are notification
adapters over the same approval API. UI text is resolved from typed message
catalogs. CI rejects a missing English key and reports missing Czech
translations.

## 6. Authorization Model

### 6.1 Visibility

Each client token has an explicit set of available upstream tools. Unauthorized
tools are omitted from `tools/list`. `tools/call` repeats the authorization
check, so a hidden tool cannot be invoked by guessing its name.

### 6.2 Policy Conditions

The MVP supports only declarative operators:

- `equals`,
- `in`,
- `startsWith`,
- `exists`.

Conditions operate on a versioned normalized context. There is no eval,
user-supplied regular-expression engine, or general scripting language.

### 6.3 Precedence

Evaluation order is:

1. explicit `deny`,
2. tool-visibility check,
3. valid specific grant,
4. explicit `allow`,
5. `require_approval`,
6. implicit `deny`.

Neither approval nor a plugin can override an explicit `deny`.

### 6.4 Grants

A one-time grant:

- is bound to one `callId`,
- includes a hash of the exact server, tool, and canonical arguments,
- cannot authorize a repeated call.

A time-limited or permanent grant:

- contains a server, tool, and explicit predicate,
- records its source, approving identity, and creation time,
- can be revoked immediately,
- cannot silently broaden after a plugin normalization-version change; an
  incompatible grant is disabled for review.

## 7. Call and Approval Flow

1. A client sends `tools/call` with a bearer token.
2. The gateway authenticates the token and creates `callId`.
3. It checks tool visibility and validates the input schema.
4. A plugin produces normalized context, redaction metadata, and presentation.
   The host may satisfy bounded same-upstream read-only resource lookups needed
   for display names; lookup failure falls back to a labeled technical ID.
5. The policy engine returns:
   - `deny`: return a structured error,
   - `allow`: continue to the upstream,
   - `require_approval`: create an approval and wait.
6. Approval UI offers deny, one-time, time-limited, or permanent approval.
7. Before execution, an atomic transition verifies that:
   - the client is still waiting,
   - the approval has not expired,
   - the request hash matches,
   - policy has not changed to `deny`,
   - execution has not already started.
8. The Upstream Registry performs exactly one call.
9. The result or error is redacted, journaled, and returned to the client.

The default approval timeout is five minutes and is configurable. A client
disconnect changes the call to `abandoned`; a later approval cannot execute it.
A process restart changes waiting calls to `interrupted`.

## 8. Persistence Without Native or WASM Database Dependencies

The data layer uses neither SQLite, PGlite, nor a third-party database runtime.

### 8.1 Configuration State Store

Small configuration and workflow state lives in typed in-memory collections.
Persistence uses stable Node.js APIs only:

- one queue serializes all mutations,
- every mutation receives a monotonic sequence number,
- the event is first appended to a recovery journal,
- the durable write completes before the mutation is acknowledged,
- a snapshot is periodically written through a temporary file, `fsync`, and
  atomic rename,
- the snapshot contains a schema version, last sequence number, and checksum,
- startup loads the latest valid snapshot and replays newer journal events,
- corrupt or incompatible state fails readiness rather than silently resetting.

This store contains upstreams, token metadata, tool access, policies, grants,
approvals, passkey credentials, plugin registrations, and system settings.

### 8.2 Call Journal

Call history is separate because it can grow without a fixed bound:

- the active day is appended to a JSONL segment,
- closed segments can be compressed with built-in `node:zlib`,
- one `callId` connects all lifecycle events for a call,
- a compact index covers time, token, upstream, tool, policy result, approval
  status, and final status,
- indexes are fully rebuildable from source segments,
- an incomplete final JSONL line after a crash is ignored and system-audited,
- retention is configurable and defaults to 90 days,
- retention deletion only affects closed segments.

Expected private usage is approximately 500–2,000 calls per day. At 2–10 KB
per call, this is roughly 0.4–7 GB per year before compression. The complete
call journal is never loaded into memory.

History supports:

- filtering by time, token, upstream, tool, result, and approval state,
- stable-cursor pagination,
- call details including arguments, decisions, latency, and result,
- JSONL and CSV exports,
- retention and manual deletion of old segments,
- creation of a policy or grant from an existing call.

Full-text search, general analytics, and replay are outside the MVP.

## 9. Logging and Redaction

By default, the system stores redacted arguments and redacted results.

Redaction happens before any persistent logging:

1. remove transport secrets and authorization headers,
2. apply central rules for common sensitive field names,
3. apply plugin-declared sensitive paths,
4. apply per-tool administrative overrides,
5. enforce a payload limit and store truncation metadata plus a content hash.

Raw credentials and client bearer tokens must never appear in the call journal,
application logs, or error objects. If redaction fails, the payload is omitted
and only redaction-failure metadata is stored.

Application logs use English structured messages and stable event codes. The UI
localizes known event codes when presenting audit and call history; it does not
rewrite persisted logs.

## 10. Security

- Upstream credentials are encrypted with a master key supplied outside the
  data directory, typically as an environment secret.
- Client tokens and recovery codes are stored only as slow hashes appropriate
  to each secret type.
- A readable client token is displayed only once at creation.
- The administrator uses passkey/WebAuthn; HTTPS is mandatory outside localhost.
- Recovery codes are one-time and their use is audited.
- Upstream URLs pass SSRF checks at configuration and every connection.
- Redirects are revalidated and DNS resolution is checked against policy.
- Loopback, link-local, metadata endpoints, and private ranges are denied by
  default. A private range can be explicitly allowed per upstream.
- A downstream token is never used as an upstream credential.
- Configuration changes, login, passkey operations, approvals, and grants are
  audited.
- Admin sessions use Secure, HttpOnly, SameSite cookies and CSRF protection.
- Approval decisions require revalidation of the current request and policy.

## 11. Dependency Policy

The project prefers the Node standard library and a small number of direct
runtime packages. It has no database runtime dependency.

Before adding a runtime package, record:

- latest release date and release cadence,
- repository activity and active maintainer count,
- weekly npm downloads and meaningful adoption,
- direct and transitive runtime dependencies,
- license,
- GitHub Advisory Database, OSV/npm audit, and behavior/supply-chain scan,
- why a Node API or smaller package is insufficient.

Exact versions are locked. CI produces an SBOM, runs dependency audits, and
blocks known high or critical runtime vulnerabilities. Updates use separate
pull requests with tests. Popularity alone does not compensate for inactivity.

## 12. Error Handling

- Invalid token: HTTP 401 without information about tool existence.
- Hidden or unknown tool: one uniform MCP error without side-channel detail.
- Invalid arguments: MCP invalid params before plugin or upstream execution.
- Policy deny: safe structured error with a stable reason code.
- Approval timeout/disconnect: no upstream call; state `expired`/`abandoned`.
- Plugin error: generic presentation or fail closed, depending on phase.
- Upstream timeout/error: no automatic retry of a mutating call.
- Persistence error: do not acknowledge the mutation; fail/degrade readiness.
- Corrupt state snapshot: fail closed with recovery instructions.
- Corrupt call segment: preserve readable events, isolate, and audit.

Protocol-facing errors use stable English text and codes. The web UI translates
known errors into the selected locale while preserving the original code.

## 13. Deployment and Operations

- One Docker container.
- One persistent data directory.
- Master key and bootstrap settings supplied as secrets.
- TLS may terminate at a trusted reverse proxy.
- Multiple writer instances cannot share one volume.
- Readiness verifies state, master key, and safe persistence.
- Upstream health affects UI and call results, not global readiness.
- A backup contains a consistent configuration snapshot, recovery journal
  events after that snapshot, and closed call segments.
- Restore verifies checksums and performs a dry-run replay before serving.

## 14. Testing Strategy

### Unit Tests

- policy precedence,
- every predicate and boundary value,
- grant expiry and revocation,
- request canonicalization and hashing,
- redaction and payload limits,
- plugin-contract validation,
- locale fallback and message-catalog completeness.

### Property-Based and Crash Tests

- the policy engine never overrides an explicit deny,
- serialization and replay preserve equivalent state,
- a crash at every persistence step yields the old or new valid state, never a
  partially acknowledged mutation,
- journal indexes are always rebuildable from source events.

### Integration Tests

- simulated Streamable HTTP upstreams,
- token-specific `tools/list`,
- complete allow/deny/approval flows,
- disconnect and timeout during approval,
- concurrent approval decisions,
- at-most-once upstream execution,
- restart with waiting requests,
- upstream tool-list-change notifications.

### UI and Security Tests

- passkey registration, login, and recovery,
- mobile approval inbox,
- switching English/Czech and persisting the selection,
- rendering the same approval and audit event in both languages,
- English fallback for incomplete plugin translations,
- SSRF and redirect bypasses,
- token and credential leakage,
- central and plugin-driven redaction,
- CSRF, session fixation, and approval race conditions.

## 15. MVP Acceptance Criteria

The MVP is complete when:

1. An administrator adds at least two remote MCP upstreams and the gateway
   exposes their tools with stable prefixes.
2. Two client tokens receive different `tools/list` results.
3. Policy can allow, deny, and require approval for a call.
4. Approval from the mobile web UI resumes the original waiting call.
5. A one-time grant cannot be reused.
6. A time-limited or permanent grant can be restricted to a value such as one
   `group_id`.
7. Disconnect before approval never causes a later upstream side effect.
8. Concurrent decisions never execute an upstream call more than once.
9. Every call is discoverable through history filters and correlates with its
   approval.
10. Credentials and bearer tokens never appear in persistent logs.
11. Configuration state recovers after simulated crashes during writes.
12. Production has no native or WASM database dependency.
13. All source code, comments, internal logs, and technical documentation are
    English.
14. Every built-in UI workflow is usable in English and Czech, with English
    fallback for missing plugin translations.

## 16. Future Extensions

The design leaves explicit interfaces for:

- push-notification adapters,
- full MCP OAuth 2.1 authentication,
- PostgreSQL or another storage backend,
- a `stdio` upstream supervisor,
- multi-tenant isolation,
- an isolated plugin runtime,
- full-text and analytical storage for the call journal,
- MCP Tasks or another asynchronous approval mode,
- additional UI locales.

These extensions are not implicitly part of the MVP and require separate
design work.
