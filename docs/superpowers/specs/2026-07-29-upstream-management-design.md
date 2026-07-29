# Upstream Management Design

## Goal

Allow an administrator to edit and remove configured MCP upstreams directly
from the Upstreams GUI without exposing stored credentials or leaving dangling
authorization records.

## Editing

Each upstream card provides an **Edit / Upravit** action that opens an inline
form. The form edits the stable alias, Streamable HTTP URL, private-network
permission, and credential state.

The server continues to return only `credentialsConfigured`; it never returns
the encrypted envelope or plaintext credential. Submitting an empty credential
field preserves the existing credential. An explicit **Remove credential**
control sends `credentials: null`. A newly entered authorization value replaces
the stored credential through `CredentialVault`.

Updates use the record's `version`. A stale update returns `409`; the GUI keeps
the user's input and offers to reload the current upstream. A successful update
reloads the upstream registry, closes obsolete connections, clears its cached
catalog, and refreshes the card.

## Cascading Removal

Each card provides a destructive **Remove / Odstranit** action. Before removal,
the GUI requests a deletion impact preview containing the number of policies and
grants that reference the upstream. The confirmation dialog names the upstream
and shows those counts.

After explicit confirmation, the server verifies the submitted upstream
version, then atomically deletes:

1. every grant whose `upstreamId` matches;
2. every policy whose `upstreamId` matches;
3. the upstream record itself.

The state store persists these operations in one `records.batch`, so a crash
cannot leave a partially deleted authorization graph. A missing upstream returns
`404`; a stale version returns `409`. After the batch commits, the runtime
registry closes and removes the upstream connection and catalog.

Call-history entries remain intact because they are audit records rather than
active configuration.

## API

- Existing `PUT /api/admin/upstreams/:id` remains the edit endpoint and gains
  complete validation for alias, URL, private-network permission, credential
  preservation, replacement, and removal.
- `GET /api/admin/upstreams/:id/deletion-impact` returns
  `{ policies: number, grants: number }`.
- `DELETE /api/admin/upstreams/:id` requires CSRF and body
  `{ version: number }`; it performs the atomic cascade.

All routes require the existing administrator session authorization. Error
responses are bounded and do not contain credentials, upstream response bodies,
or connection details.

## GUI

The Upstreams page keeps discovery and management on the same card:

- normal view: badges, discovery, **Edit**, and **Remove** actions;
- edit view: prefilled non-secret fields, blank replacement credential input,
  explicit credential-removal checkbox, Save and Cancel;
- removal view: upstream name, affected policy/grant counts, destructive
  confirmation, Cancel, and progress/error state.

All copy is available in English and Czech. Tool descriptions, schemas, aliases,
and URLs remain rendered as text rather than HTML.

## Verification

Server tests cover credential preservation/replacement/removal, stale versions,
impact counts, atomic cascade deletion, audit-history preservation, and runtime
reload callbacks. GUI tests cover edit-form rendering without credential
material, delete-impact rendering, confirmation, and bilingual catalog
completeness. The repository-wide `npm run verify` command must pass.
