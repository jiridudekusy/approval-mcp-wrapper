# Upstream Tool Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display tools discovered from each configured MCP upstream in the administration GUI and make those tools selectable when creating policies.

**Architecture:** Extend the authenticated upstream administration routes with a runtime discovery callback backed by `UpstreamRegistry.refresh()`. Add a reusable web catalog type and render discovery state locally per upstream; the Access page fetches the same endpoint and passes tool names to the policy editor.

**Tech Stack:** Node.js 24, TypeScript 7, Fastify 5, React 19, Vitest 4, official MCP SDK.

## Global Constraints

- Discovered catalogs remain runtime-only and are not written to durable configuration.
- One failed upstream must not prevent other upstream cards or policies from loading.
- Tool metadata is rendered as text and formatted JSON, never injected as HTML.
- All new GUI copy must exist in both English and Czech catalogs.
- No new runtime dependency is introduced.

---

### Task 1: Authenticated upstream discovery API

**Files:**
- Modify: `apps/server/src/admin/upstream-routes.ts`
- Modify: `apps/server/src/admin/upstream-routes.test.ts`
- Modify: `apps/server/src/admin/index.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Consumes: `UpstreamRegistry.refresh(upstreamId): Promise<ToolCatalog>`
- Produces: `GET /api/admin/upstreams/:id/tools` returning `ToolCatalog`

- [ ] **Step 1: Write failing route tests**

Add tests that authenticate an administrator, request
`/api/admin/upstreams/:id/tools`, and assert that the injected discovery
callback receives the configured ID and returns its sorted tool catalog. Add
separate assertions for `404` on an unknown ID and `502` when discovery throws.

```ts
const response = await app.inject({
  method: 'GET',
  url: `/api/admin/upstreams/${upstream.id}/tools`,
  headers: authenticatedHeaders,
});
expect(response.statusCode).toBe(200);
expect(response.json().tools.map((tool: { name: string }) => tool.name))
  .toEqual(['alpha', 'zeta']);
```

- [ ] **Step 2: Verify the new test fails**

Run:

```bash
npx vitest run apps/server/src/admin/upstream-routes.test.ts
```

Expected: failure because the route returns `404`.

- [ ] **Step 3: Implement the route and runtime callback**

Extend `registerUpstreamRoutes` and `registerAdminRoutes` with:

```ts
discoverTools?(upstreamId: UpstreamId): Promise<ToolCatalog>;
```

Authorize the request, verify the upstream exists in state, call the callback,
return the catalog, and map a refresh failure to a bounded
`upstream.discovery_failed` response with status `502`. In `main.ts`, pass
`(upstreamId) => upstreams.refresh(upstreamId)`.

- [ ] **Step 4: Verify server tests pass**

Run:

```bash
npx vitest run apps/server/src/admin/upstream-routes.test.ts
```

Expected: all upstream administration tests pass.

- [ ] **Step 5: Commit the API**

```bash
git add apps/server/src/admin apps/server/src/main.ts
git commit -m "feat: expose upstream tool discovery"
```

### Task 2: Tool catalog GUI and policy selection

**Files:**
- Modify: `apps/web/src/pages/upstreams.tsx`
- Modify: `apps/web/src/pages/access.tsx`
- Modify: `apps/web/src/components/policy-editor.tsx`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/i18n/cs.ts`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `GET /api/admin/upstreams/:id/tools`
- Produces: per-upstream discovery panel and `PolicyEditor` property
  `tools: readonly { name: string; description?: string }[]`

- [ ] **Step 1: Write failing GUI tests**

Mock the tools endpoint with a catalog containing `signal_send_message`, render
the relevant page, activate **Discover tools**, and assert that the name and
description appear. Render `PolicyEditor` with that catalog and assert that its
tool control is a `select` containing the discovered tool.

```tsx
render(<PolicyEditor
  csrfToken="csrf"
  tokenId="token"
  upstreamId="upstream"
  tools={[{ name: 'signal_send_message', description: 'Send a message' }]}
  onCreated={() => undefined}
/>);
expect(screen.getByRole('option', { name: 'signal_send_message' })).toBeVisible();
```

- [ ] **Step 2: Verify the GUI tests fail**

Run:

```bash
npx vitest run apps/web/src/app.test.tsx
```

Expected: TypeScript/render failure because `PolicyEditor` has no `tools`
property and the Upstreams page has no discovery action.

- [ ] **Step 3: Implement the upstream catalog panel**

Add a shared local `ToolView` shape, per-card loading/error/catalog state, and a
button that requests the tools endpoint. Render tool names, descriptions, and
expandable input/output schemas using `<details>`, `<pre>`, and
`JSON.stringify(schema, null, 2)`.

- [ ] **Step 4: Implement policy tool selection**

When `upstreamId` changes, request its tool catalog. Pass the returned tools to
`PolicyEditor`; render a required `select` when tools exist and retain the
existing required text input when discovery fails or returns no tools.

- [ ] **Step 5: Add bilingual copy and styles**

Add exact EN/CZ keys for discovery, loading, retry, empty catalog, schema
labels, and discovery errors. Add compact catalog styles consistent with the
existing cards and responsive mobile layout.

- [ ] **Step 6: Verify GUI tests pass**

Run:

```bash
npx vitest run apps/web/src/app.test.tsx
```

Expected: all web tests pass.

- [ ] **Step 7: Run repository verification**

Run:

```bash
npm run verify
```

Expected: typecheck,  tests, production build, dependency audit, and EN/CZ
catalog verification all pass.

- [ ] **Step 8: Commit and restart the local instance**

```bash
git add apps/web
git commit -m "feat: display discovered upstream tools"
```

Rebuild, restart the container-facing development process with the active
forwarded public origin, and verify `/health/ready` plus the GUI catalog flow.
