# Upstream Tool Catalog Design

## Goal

Make tools discovered from configured MCP upstreams visible and selectable in
the administration GUI. Discovery already exists inside the runtime; this
change exposes it through an authenticated administration endpoint and presents
the result without making the whole page depend on every upstream being online.

## Server API

Add `GET /api/admin/upstreams/:id/tools`. The endpoint requires an authenticated
administrator session, resolves only an existing configured upstream, and asks
the runtime `UpstreamRegistry` to refresh that upstream's catalog with
`tools/list`.

The successful response contains the upstream ID, refresh timestamp, and tools
sorted by name. Each tool includes its name, optional description, input schema,
optional output schema, and optional annotations. Credentials and internal
connection details are never returned.

An unknown upstream returns `404`. A discovery or connection failure returns a
bounded `502` administration error for that upstream and does not affect other
upstreams or cached policies.

## Upstreams GUI

Each upstream card gets a bilingual **Discover tools / Načíst tooly** action.
Activating it displays an inline loading state and then an expandable catalog on
that same card. Tool rows show the name and description; their schemas can be
expanded on demand so large schemas do not dominate the page.

Errors are displayed on the affected card and can be retried. Tool discovery is
also triggered after creating a new upstream, but opening the Upstreams page
does not automatically contact every configured MCP.

## Policy Editor

When a token and upstream are selected, the Access page requests that
upstream's catalog. The policy editor uses a tool-name dropdown when discovery
succeeds. It retains a manual text fallback when the upstream is offline or has
no discovered tools, so existing policies can still be managed during an
outage.

## State and Security

Discovered catalogs remain runtime cache data and are not added to the durable
configuration journal. A restart simply requires discovery again. The endpoint
uses the existing administrator authorization and SSRF-pinned upstream
transport. Tool descriptions and schemas are rendered as React text or
formatted JSON, never as HTML.

## Verification

Server tests cover authenticated discovery, unknown upstreams, and failed
upstream refreshes. UI tests cover rendering discovered tools, the per-upstream
error state, and selecting a discovered tool for a policy. The repository-wide
verification command must continue to pass.
