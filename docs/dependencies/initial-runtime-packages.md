# Initial Runtime Package Admission

Assessment date: 2026-10-05

## @modelcontextprotocol/client@2.0.0

- Release line: stable SDK v2 split package.
- Maintainers: official Model Context Protocol project with six npm maintainers.
- Runtime dependencies: seven, including the exact matching core package.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: official MCP client, Streamable HTTP transport, and automatic
  legacy/modern protocol negotiation for upstream connections.

## @modelcontextprotocol/core@2.0.0

- Release line: stable SDK v2 split package.
- Maintainers: official Model Context Protocol project with six npm maintainers.
- Runtime dependencies: one (Zod).
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: shared official MCP wire types and validation used by the client,
  server, and Node adapter.

## @modelcontextprotocol/node@2.0.0

- Release line: stable SDK v2 split package.
- Maintainers: official Model Context Protocol project with six npm maintainers.
- Runtime dependencies: one plus two peers.
- License: MIT.
- Security: the 2026-08-12 audit has no high or critical runtime advisory. Its
  nested Hono adapter has a moderate Windows-only `serve-static` advisory; this
  service does not import or expose that adapter's static-file middleware.
- Rationale: official adapter between Node HTTP requests and the web-standard
  dual-era MCP handler.

## @modelcontextprotocol/server@2.0.0

- Release line: stable SDK v2 split package.
- Maintainers: official Model Context Protocol project with seven npm maintainers.
- Runtime dependencies: two, including the exact matching core package.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: official MCP server and dual-era HTTP handler supporting both the
  2025-11-25 and 2026-07-28 protocol generations.

## fastify@5.12.5

- Latest release: 2026-09-16.
- Adoption: approximately 10 million weekly downloads and more than 5,000 dependents.
- Maintainers: active OpenJS Foundation project with multiple maintainers.
- Runtime dependencies: 15.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: maintained HTTP framework with schema validation, injection testing, lifecycle hooks, and streaming support.

## @fastify/static@10.1.2

- Latest release: 2026-07-23.
- Adoption: approximately 136,000 weekly downloads for the latest version.
- Maintainers: official Fastify organization.
- Runtime dependencies: verified from the installed lockfile during admission.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: safely serves the production Vite assets through the same Fastify process.

## zod@4.4.3

- Latest release: 2026-04.
- Adoption: more than 198 million weekly downloads and more than 110,000 dependents.
- Maintainers: active project with a stable v4 release line.
- Runtime dependencies: zero.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: required by the official MCP SDK and used for boundary validation.

## @simplewebauthn/server@13.3.2

- Latest release: 2026-06.
- Adoption: approximately 2.1 million weekly downloads and more than 300 dependents.
- Maintainers: active SimpleWebAuthn project.
- Runtime dependencies: eight.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: standards-sensitive WebAuthn verification is not appropriate to reimplement.

## @simplewebauthn/browser@13.3.0

- Latest release: 13.3.0; server and browser packages use independent release versions.
- Adoption: established browser companion to the server package.
- Maintainers: active SimpleWebAuthn project.
- Runtime dependencies: verified from the installed lockfile during admission.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: normalizes browser WebAuthn ceremony encoding and error handling.

## react@19.2.8

- Latest release: 2026-07-21.
- Adoption: more than 135 million weekly downloads and more than 200,000 dependents.
- Maintainers: Meta React team.
- Runtime dependencies: zero.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: accessible, stateful administration and approval UI.

## react-dom@19.2.8

- Latest release: aligned with React 19.2.8.
- Adoption: core React browser renderer with ecosystem-scale usage.
- Maintainers: Meta React team.
- Runtime dependencies: verified from the installed lockfile during admission.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: required to render the React web application.
