# Session Validity and Resilient Logout Design

## Problem

The web application currently treats the presence of the readable `amcp_csrf`
cookie as proof of authentication. The server-side session can expire or be
revoked while that cookie remains in the browser. After a reload, the UI then
renders the authenticated shell, protected API calls return `401`, the approval
event stream reconnects indefinitely, and logout cannot finish because its
local state change only runs after a successful server response.

## Required behavior

- A browser with a valid server session opens the authenticated application.
- A browser with a missing, expired, or revoked server session is sent to the
  login screen and its readable CSRF cookie is cleared.
- A transient network or server outage does not log the user out. The current
  application remains visible and reports that it is reconnecting.
- Logout attempts to revoke the server session and clear the HttpOnly cookie,
  but always clears client authentication state even if that request fails.
- No passkeys, recovery codes, MCP tokens, approvals, or audit records are
  changed by client session recovery.

## Design

### Session validation endpoint

Add `GET /api/auth/session`. It reads the `amcp_admin` HttpOnly cookie and
validates it with `SessionService` without requiring a CSRF header because the
operation is read-only. A valid session returns `200` with a minimal
`{ authenticated: true }` body and `Cache-Control: no-store`. A missing,
expired, or revoked session returns the standard `401 auth.unauthorized`
response. The endpoint does not extend session lifetime or rotate credentials.

### Application startup

Authentication has three client states: `checking`, `authenticated`, and
`anonymous`. When an `amcp_csrf` cookie exists, the application starts in
`checking` and calls the session validation endpoint before rendering protected
pages. A `200` response transitions to `authenticated`. A `401` response clears
the readable CSRF cookie and transitions to `anonymous`. A network failure
transitions to `authenticated` based on the locally retained CSRF cookie, so the
application remains available with its normal reconnect state; it is not
interpreted as an invalid session.

When no CSRF cookie exists, startup goes directly to `anonymous` without a
validation request.

### Authentication loss during use

The API client publishes one application-level authentication-loss signal when
a request under `/api/admin/` returns `401`. The root application owns the response: it
clears the readable CSRF cookie, drops the in-memory CSRF token, closes protected
views through unmounting, and renders login. Network errors and `5xx` responses
do not publish this signal. A generic `403` also does not log the user out,
because it may represent a valid session with a failed CSRF or authorization
check.

The approval event hook already performs a normal protected refresh alongside
the SSE connection. Its `401` therefore reaches the same API-client signal,
while an EventSource transport error remains a reconnect condition. Expected
refresh failures are handled so they do not become unhandled promise rejections.

### Logout

Logout remains a server-backed security operation: only the server can revoke
the durable session and expire the HttpOnly cookie. The UI invokes the existing
logout endpoint, then clears the readable CSRF cookie and local authentication
state in a `finally` path. Consequently, an expired session or network failure
still returns the current tab to login. If the server could not be reached, the
server-side session remains valid until expiry; this limitation is explicit and
does not get misrepresented as successful server revocation.

## Error handling

- Session validation `401`: clear client authentication and show login.
- Session validation network failure: retain the application and reconnect.
- Protected API `401`: clear client authentication and show login.
- Protected API `403`: keep the session and surface the operation error.
- Logout failure: clear local authentication; do not claim server revocation.

## Testing

- Route tests cover valid, missing, expired, and revoked session cookies plus
  the `no-store` response header.
- Client tests cover startup with a valid session, startup with a confirmed
  `401`, and preservation of the authenticated UI on a network error.
- API-client tests prove that only `401` emits authentication loss.
- Logout tests prove that local cleanup runs after success, `401`, and network
  failure.
- Existing authentication, CSRF, SSE reconnect, language, build, and dependency
  checks remain green.

## Non-goals

- Sliding session expiration or background session renewal.
- Treating temporary SSE disconnection as logout.
- Making the HttpOnly session cookie readable by JavaScript.
- Changing the twelve-hour server session lifetime.
