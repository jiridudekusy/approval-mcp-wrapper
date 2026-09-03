# Initial Runtime Package Admission

Assessment date: 2026-09-03

## @modelcontextprotocol/sdk@1.30.0

- Latest release: 2026-07-28.
- Adoption: approximately 45 million weekly downloads and more than 63,000 dependents.
- Maintainers: official Model Context Protocol project with multiple npm maintainers.
- Runtime dependencies: 17; Zod is a required peer.
- License: MIT.
- Security: must pass the lockfile npm audit and CI advisory gate before merge.
- Rationale: official client/server implementation of MCP Streamable HTTP and protocol negotiation.

## fastify@5.12.1

- Latest release: 2026-08-18.
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
