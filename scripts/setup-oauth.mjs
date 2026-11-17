import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

export function openBrowser(url) {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
      stdio: 'ignore', detached: true,
    });
    child.once('error', () => resolve(false));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

/** Authorization Code + S256. Tokens stay in this process, never in argv/files/logs. */
export async function authorizeSetup({
  server, source, fetchImpl = fetch, log = () => {}, open = openBrowser,
  timeoutMs = 15 * 60_000, callbackPort = 0, callbackBind = '127.0.0.1',
  signal: parentSignal,
}) {
  const origin = new URL(server).origin;
  if (server.replace(/\/+$/, '') !== origin || !['http:', 'https:'].includes(new URL(origin).protocol)) throw new Error('Invalid server origin');
  if (!Number.isInteger(callbackPort) || callbackPort < 0 || callbackPort > 65535 ||
    !['127.0.0.1', '0.0.0.0'].includes(callbackBind)) throw new Error('Invalid callback binding');
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  const signal = parentSignal === undefined ? timeout : AbortSignal.any([timeout, parentSignal]);
  signal.throwIfAborted();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let resolveCallback, rejectCallback;
  const callback = new Promise((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
  // A failed registration/discovery must not leave a later unhandled timeout.
  void callback.catch(() => {});
  const abort = () => rejectCallback(new Error('OAuth timed out'));
  signal.addEventListener('abort', abort, { once: true });
  let redirectUri;
  const listener = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    const url = new URL(request.url ?? '/', redirectUri);
    if (request.method !== 'GET' || url.pathname !== '/callback' ||
      request.headers.host !== new URL(redirectUri).host || url.searchParams.get('state') !== state ||
      url.searchParams.get('iss') !== origin ||
      (!url.searchParams.has('error') && !url.searchParams.has('code'))) {
      response.writeHead(400).end('Invalid authorization response');
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Approval MCP setup</title><style>body{font:18px system-ui;background:#f4f6fc;color:#142039;display:grid;place-items:center;min-height:90vh;margin:0}main{background:white;border:1px solid #dbe2ef;border-radius:24px;padding:40px;max-width:480px;margin:20px}small{color:#2359ed}h1{font-size:30px}</style><main><small>APPROVAL MCP · SETUP</small><h1>Authorization response received</h1><p>Return to the setup command to continue. You can close this tab.</p></main></html>');
    if (url.searchParams.has('error')) rejectCallback(new Error('Authorization denied'));
    else resolveCallback(url.searchParams.get('code'));
  });
  const json = async (url, init = {}) => {
    const response = await fetchImpl(url, { ...init, signal, redirect: 'error' });
    if (!response.ok) throw new Error('OAuth request rejected');
    return response.json();
  };
  try {
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(callbackPort, callbackBind, resolve);
    });
    redirectUri = `http://127.0.0.1:${listener.address().port}/callback`;
    const metadata = await json(`${origin}/.well-known/oauth-authorization-server`);
    if (metadata.issuer !== origin || metadata.registration_endpoint !== `${origin}/oauth/register` ||
      metadata.token_endpoint !== `${origin}/oauth/token` ||
      !Array.isArray(metadata.scopes_supported) || !metadata.scopes_supported.includes('setup:submit')) throw new Error('Setup OAuth is unavailable');
    const authorization = new URL(metadata.authorization_endpoint);
    if (!['http:', 'https:'].includes(authorization.protocol) || authorization.username || authorization.password ||
      authorization.pathname !== '/oauth/authorize' || authorization.search || authorization.hash) throw new Error('Invalid authorization endpoint');
    const client = await json(metadata.registration_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: `Setup: ${source}`.slice(0, 120), redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
    });
    const resource = `${origin}/api/setup`;
    authorization.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri,
      resource, scope: 'setup:submit', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state }).toString();
    log(`approval-mcp-setup: authorize setup access at ${authorization.href}`);
    void Promise.resolve(open(authorization.href)).catch(() => false);
    const code = await callback;
    const token = await json(metadata.token_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id,
        redirect_uri: redirectUri, code, code_verifier: verifier, resource }).toString(),
    });
    if (token.token_type !== 'Bearer' || token.scope !== 'setup:submit' ||
      typeof token.access_token !== 'string' || !/^amcpoa_[A-Za-z0-9_-]{43}$/.test(token.access_token)) throw new Error('Invalid setup token');
    return token.access_token;
  } finally {
    signal.removeEventListener('abort', abort);
    listener.closeAllConnections();
    await new Promise((resolve) => listener.close(resolve));
  }
}
