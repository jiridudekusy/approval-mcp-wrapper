# Deployment

Approval MCP Wrapper runs as one Node.js 24 process and one writer over a
persistent data directory. The supported production shape is the supplied
container behind a TLS reverse proxy.

Required environment variables:

- `APPROVAL_MCP_PUBLIC_URL`: externally visible HTTPS origin, with no path.
- `APPROVAL_MCP_DATA_DIR`: absolute persistent directory; `/data` in the image.
- `APPROVAL_MCP_MASTER_KEY`: canonical base64 encoding of 32 random bytes.

Generate the master key with `openssl rand -base64 32`. Store it in a secret
manager. Losing it makes encrypted upstream credentials unrecoverable. Do not
put it in an image, Compose file, Git repository, or backup manifest.

Map persistent storage to `/data`, publish port 3000 only to the reverse proxy,
and forward the original host and scheme. The public URL fixes the WebAuthn RP
ID and origin; changing its hostname requires registering a new passkey.

The image runs as the unprivileged `node` user. Use a read-only root filesystem
with `/data` as its writable volume. Probe `/health/live` for liveness and
`/health/ready` for readiness. Individual upstream failures are visible in the
admin UI but do not make the wrapper globally unready.
