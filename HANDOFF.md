# Approval MCP Wrapper — Engineering Handoff

Last updated: 2026-08-03

## Current state

The current product is on the `codex/ui-redesign` branch. It is a private,
single-operator MCP gateway that aggregates remote Streamable HTTP MCP servers,
exposes a token-specific tool catalog, evaluates access policy, pauses sensitive
calls for human approval, and records the complete call lifecycle.

This handoff intentionally covers source code only. Existing development data,
sessions, passkeys, client tokens, upstream credentials, approvals, grants, and
call history are not part of the move. The next installation should start with
an empty data directory and a newly generated master key.

The latest product work includes:

- a redesigned responsive administration UI with English and Czech locales;
- upstream creation, editing, deletion, and tool discovery;
- client-token creation and revocation;
- composable access profiles, multiple profiles per token, default profiles for
  tokens without explicit assignments, server-wide rules, and per-tool
  overrides;
- pending approval delivery over SSE and one-time, one-hour, or permanent
  decisions with optional argument predicates;
- active grant management and call history;
- passkey authentication, recovery codes, CSRF protection, and durable admin
  sessions;
- resilient browser-session validation: confirmed `401` responses return the
  UI to login, transient network failures keep the application visible, and
  logout always clears local authentication state;
- an MCP endpoint at `/mcp`, health endpoints, a durable configuration store,
  append-only call journals, retention support, and a production Docker image.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/server` | Fastify composition root, authentication, admin API, SSE, static UI hosting, health, retention, and `/mcp` transport |
| `apps/web` | React control plane, responsive approval inbox, access/profile editor, upstream management, history, system status, themes, and EN/CS localization |
| `packages/contracts` | Shared branded IDs and persisted domain entities |
| `packages/gateway` | Token authentication, MCP protocol handling, tool catalog, call coordination, and approval orchestration |
| `packages/policy` | Pure policy evaluation, predicates, grants, and profile resolution |
| `packages/upstream` | Remote MCP clients, SSRF/address controls, encrypted credential envelopes, and upstream registry |
| `packages/state-store` | Node-only durable snapshot and recovery-journal storage; no native or WASM database dependency |
| `packages/call-journal` | Segmented JSONL call history, redaction, indexes, export, and retention |
| `packages/plugin-sdk` | Trusted server-side plugin contracts and generic presentation fallback |
| `docs/operations` | Deployment, backup/restore, and disaster-recovery notes |
| `docs/superpowers/specs` | Approved product and feature designs |

The application is a modular monolith: one Node.js process and one writer for
the persistent data directory. Do not run multiple replicas against the same
data directory.

## Authorization behavior

Public tool names use `upstreamAlias__toolName`. `tools/list` is filtered for
the authenticated client token and `tools/call` repeats authorization, so a
hidden tool cannot be invoked by guessing its name.

Profiles are collections of server-level and tool-level rules. A token may have
multiple explicitly assigned profiles. Default profiles apply only when the
token has no explicit profile assignments. A tool-level rule overrides the
server-level rule within the same profile. When several active rules apply,
the restrictive order is `deny`, `require_approval`, then `allow`. Direct
token policies are also included in evaluation.

Declarative predicates support `equals`, `in`, `startsWith`, and `exists` over
structured request context. There is no runtime `eval`, user-provided code, or
regular-expression policy engine.

## Approval and call flow

1. A client calls `/mcp` with a bearer token.
2. The gateway validates the token and resolves the token-specific catalog.
3. Arguments and visibility are validated before policy evaluation.
4. Policy returns `allow`, `deny`, or `require_approval`.
5. A required approval is persisted and published to the web inbox over SSE.
6. The operator denies it or grants one-time, time-limited, or permanent access.
7. Policy and request identity are checked again before execution.
8. The upstream call executes at most once and lifecycle events are journaled.

Pending approvals are marked interrupted after a process restart; they are not
automatically replayed.

## Authentication model

- Admin authentication uses WebAuthn/passkeys with recovery codes.
- `amcp_admin` is the HttpOnly session cookie.
- `amcp_csrf` is a readable, SameSite-strict CSRF cookie used by the web client.
- `GET /api/auth/session` confirms that a retained browser session is still
  valid and is never cached.
- A protected admin API `401` clears client authentication and opens login.
- Network failures and SSE transport errors do not log the operator out.
- Logout attempts server-side revocation but performs local cleanup even when
  the server is unavailable.
- Downstream MCP bearer tokens are shown once and stored only as scrypt
  verifiers. They are never forwarded upstream.
- Upstream credentials are encrypted with the installation master key.

## Requirements and local startup

Use Node.js 24 and npm. Runtime dependency versions are intentionally exact.

```bash
npm ci
npm run verify
```

For a clean local installation:

```bash
export APPROVAL_MCP_PUBLIC_URL=http://localhost:3000
export APPROVAL_MCP_DATA_DIR=/absolute/path/to/new/data
export APPROVAL_MCP_MASTER_KEY="$(openssl rand -base64 32)"
export HOST=127.0.0.1
export PORT=3000
npm run build
node apps/server/dist/main.js
```

Open `http://localhost:3000`, bootstrap the administrator passkey, store the
recovery codes, then create upstreams, profiles, and client tokens in the UI.

`APPROVAL_MCP_PUBLIC_URL` is part of the WebAuthn identity. Production requires
an externally visible HTTPS origin without a path. Only exact loopback hosts may
use HTTP. Changing the hostname later requires registering a new passkey.

When an MCP client runs inside Docker or Apple Containers, bind the service to
`0.0.0.0` and use the host gateway address from the client, for example
`http://host.docker.internal:3000/mcp`. The MCP client must send its generated
client token as `Authorization: Bearer <token>`. Keep the browser-facing public
URL equal to the actual browser origin so WebAuthn and origin validation agree.

## Runtime configuration

Required:

- `APPROVAL_MCP_PUBLIC_URL`: clean public origin; HTTPS except exact loopback;
- `APPROVAL_MCP_DATA_DIR`: absolute, private, writable persistent directory;
- `APPROVAL_MCP_MASTER_KEY`: canonical base64 encoding of exactly 32 random
  bytes.

Optional:

- `HOST`: listener address, default `127.0.0.1`;
- `PORT`: listener port, default `3000`;
- `APPROVAL_MCP_RETENTION_DAYS`: call-journal retention, default `90`.

Never commit the master key. Losing it makes encrypted upstream credentials
unrecoverable. For this move, generate a new key because no existing data is
being transferred.

## Container deployment

The supplied multi-stage `Dockerfile` builds and runs the server as the
unprivileged `node` user on port 3000. Mount the only writable persistent volume
at `/data`, keep the root filesystem read-only when possible, and place the
service behind a TLS reverse proxy.

Use:

- `/health/live` for liveness;
- `/health/ready` for readiness;
- `/mcp` for downstream MCP traffic;
- `/` for the administration UI.

Upstream failures are reported in the UI but do not make the entire gateway
unready.

## Verification

The canonical pre-handoff check is:

```bash
npm run verify
```

It runs TypeScript project-reference checks, all Node and Vitest tests, the web
production build, a production dependency audit at high severity, and EN/CS
catalog completeness validation. Run it after installation and before any
release or deployment.

## Important limitations and next work

- The MVP supports remote Streamable HTTP upstreams, not local stdio MCP
  processes.
- It is single-tenant and single-writer; horizontal scaling is intentionally
  unsupported.
- One upstream currently has one credential set.
- The web inbox uses SSE. Mobile push notifications and a native mobile app are
  not implemented.
- The plugin SDK and generic presentation path exist, but a complete plugin
  installation/management experience and tool-specific approval presentations
  remain future work.
- Downstream authentication uses private bearer tokens, not a complete MCP OAuth
  authorization-server flow.
- Mutating tool calls are not automatically retried or replayed.
- Existing development data is deliberately excluded from this handoff.

## Source-of-truth documents

Read these before changing security or persistence behavior:

- `docs/superpowers/specs/2026-07-28-approval-mcp-wrapper-design.md`
- `docs/superpowers/specs/2026-08-01-session-validity-and-logout-design.md`
- `docs/operations/deployment.md`
- `docs/operations/backup-and-restore.md`
- `docs/operations/disaster-recovery.md`

Keep source code, comments, commit messages, and technical documentation in
English. The UI must keep both English and Czech catalogs complete.
