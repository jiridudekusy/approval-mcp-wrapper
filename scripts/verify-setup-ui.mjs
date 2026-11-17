// Isolated OAuth + real MCP + real WebAuthn fixture. Never touches deployment data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import fastifyStatic from '@fastify/static';
import { chromium, expect } from '@playwright/test';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { createConfigStateStore } from '@approval-mcp/state-store';
import { CredentialVault } from '@approval-mcp/upstream';
import { TokenService, StateStoreTokenRepository } from '@approval-mcp/gateway';
import { buildServerApp } from '../apps/server/dist/app.js';
import { OAuthService } from '../apps/server/dist/oauth-service.js';
import { PasskeyService, InMemoryPasskeyRepository } from '../apps/server/dist/passkey-service.js';
import { SessionService, InMemorySessionRepository } from '../apps/server/dist/session-store.js';
import { RecoveryService, InMemoryRecoveryRepository } from '../apps/server/dist/recovery-service.js';
import { registerAdminRoutes } from '../apps/server/dist/admin/index.js';
import { SetupService } from '../apps/server/dist/setup/setup-service.js';
import { registerSetupRoutes } from '../apps/server/dist/setup/setup-routes.js';
import { runSetup } from './approval-mcp-setup.mjs';

const fixture = await mkdtemp(join(tmpdir(), 'approval-setup-ui-state-'));
const output = process.env.SETUP_SCREENSHOT_DIR ?? await mkdtemp(join(tmpdir(), 'approval-setup-ui-artifacts-'));
await mkdir(output, { recursive: true });
const state = await createConfigStateStore(join(fixture, 'data'));
const vault = new CredentialVault(randomBytes(32));
const sessions = new SessionService(new InMemorySessionRepository());
let oauth, passkeys, origin, app, browser, cli, page;
const cancel = new AbortController();
let calls = 0, signatures = 0;
const mcp = createMcpHandler(() => {
  const server = new McpServer({ name: 'setup-fixture', version: '1' });
  server.registerTool('sample_write', { inputSchema: z.object({}) }, async () => { calls++; return { content: [] }; });
  return server;
});
const nodeMcp = toNodeHandler(mcp);
const upstream = createServer((request, response) => {
  if (request.headers['x-api-key'] !== 'fixture-only-key') { response.writeHead(401).end('Unauthorized'); return; }
  void nodeMcp(request, response);
});
const opened = [], logs = [], errors = [];
const waitForOpen = async () => {
  for (let index = 0; index < 200; index++) {
    if (opened.length > 0) return opened.shift();
    await delay(50);
  }
  throw new Error('CLI did not open the expected browser step');
};
try {
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const passkeyApi = {
    bootstrapOptions: () => passkeys.bootstrapOptions(), verifyBootstrap: (value) => passkeys.verifyBootstrap(value),
    loginOptions: () => passkeys.loginOptions(), verifyLogin: async (value) => { const result = await passkeys.verifyLogin(value); signatures++; return result; },
  };
  // Route closures resolve the service only after listen establishes this fixture's origin.
  const oauthFacade = new Proxy({}, { get: (_target, key) => typeof oauth[key] === 'function' ? oauth[key].bind(oauth) : oauth[key] });
  app = await buildServerApp({ oauth: oauthFacade, auth: { sessions, passkeys: passkeyApi, secureCookies: false,
    recovery: new RecoveryService(new InMemoryRecoveryRepository()) } });
  const setup = new SetupService({ state, credentialVault: vault, get publicOrigin() { return origin; },
    claimRequest: (requester, digest) => oauth.claimSetup(requester.id, digest) });
  await registerSetupRoutes(app, { setup, sessions, passkeys: passkeyApi, authenticateRequester: async (token, host) => {
    const from = oauth.originForHost(host);
    const id = from && oauth.authenticate(token, from, 'setup:submit');
    return id ? { id, label: state.read((current) => current.clientTokens[id].label), singleUse: true } : undefined;
  }, completeRequester: (requester) => oauth.completeSetup(requester.id) });
  await registerAdminRoutes(app, { sessions, state, tokens: new TokenService(new StateStoreTokenRepository(state)), credentialVault: vault });
  app.get('/api/storage/status', async () => ({ locked: false, initialized: true, environmentUnlock: true, primaryOrigin: origin, slots: [] }));
  await app.register(fastifyStatic, { root: resolve('apps/web/dist'), wildcard: false });
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({}) : reply.sendFile('index.html'));
  origin = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('127.0.0.1', 'localhost');
  oauth = new OAuthService(state, origin);
  passkeys = new PasskeyService({ rpName: 'Setup test', rpId: 'localhost', expectedOrigin: origin, repository: new InMemoryPasskeyRepository() });
  browser = await chromium.launch({ headless: true, ...(process.env.DEMO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DEMO_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.route('**/*', (route) => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => { localStorage.setItem('approval-mcp.locale', 'en'); localStorage.setItem('approval-mcp.theme', 'light'); });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(`${origin}/access`);
  await page.getByRole('button', { name: 'Continue with passkey', exact: true }).click();
  await page.getByRole('heading', { name: 'Access', exact: true }).waitFor();
  console.log('Setup UI: throwaway passkey enrolled');
  const declaration = JSON.stringify({ source: 'Workspace UI test', upstreams: [{ alias: 'sample', displayName: 'Sample authenticated MCP',
    url: `http://127.0.0.1:${upstream.address().port}/mcp`, allowPrivateNetwork: true, credentialFields: ['X-API-Key'] }] });
  cli = runSetup({ file: '-', server: origin, env: {}, readText: async () => declaration, signal: cancel.signal,
    log: (line) => logs.push(line), open: async (url) => { opened.push(url); return true; }, timeoutMs: 120_000 });
  await page.goto(await waitForOpen());
  await page.getByRole('heading', { name: 'Allow workspace setup', exact: true }).waitFor();
  await expect(page.getByText('Setup access only:', { exact: false })).toBeVisible();
  assert.equal(await page.getByLabel('Access profile', { exact: true }).count(), 0);
  assert.equal(await page.locator('select').count(), 0, 'Setup consent must not ask for a profile or lifetime');
  await expect(page.getByText('Only for this setup', { exact: true })).toBeVisible();
  assert.equal(await page.getByText('Estimated expiry', { exact: true }).count(), 0);
  await page.screenshot({ path: join(output, 'setup-oauth.png'), fullPage: true });
  const consentResponse = page.waitForResponse((response) => response.url().includes('/api/oauth/requests/') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirm with passkey', exact: true }).click();
  const consentBody = (await consentResponse).request().postDataJSON();
  assert.equal('lifetimeSeconds' in consentBody, false);
  assert.equal('profileId' in consentBody, false);
  await page.getByRole('heading', { name: 'Authorization response received', exact: true }).waitFor();
  console.log('Setup UI: OAuth consent and real loopback callback completed');
  await page.goto(await waitForOpen());
  await page.getByRole('heading', { name: 'Review upstream changes', exact: true }).waitFor();
  const confirm = page.getByRole('button', { name: 'Confirm with passkey', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/^X-API-Key/).fill('wrong-key');
  await page.getByRole('button', { name: 'Test MCP connections', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Authentication was rejected' }).waitFor();
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/^X-API-Key/).fill('fixture-only-key');
  await page.getByRole('button', { name: 'Test MCP connections', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'MCP connection and authentication verified' }).waitFor();
  await expect(confirm).toBeEnabled();
  assert.equal(Object.keys(state.read((current) => current.upstreams)).length, 0);
  await page.getByLabel(/^X-API-Key/).fill('changed-after-verification');
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/^X-API-Key/).fill('fixture-only-key');
  await page.getByRole('button', { name: 'Test MCP connections', exact: true }).click();
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: join(output, 'setup-verified.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: join(output, 'setup-mobile-dark.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await confirm.click();
  await page.getByText('Changes applied. You can close this page.', { exact: true }).waitFor();
  assert.equal(await cli, 0);
  assert.ok(Object.values(state.read((current) => current.oauthGrants)).every((grant) => grant.revokedAt), 'Setup grants must be revoked after result acknowledgement');
  const stored = Object.values(state.read((current) => current.upstreams))[0];
  assert.deepEqual(vault.decrypt(stored.id, stored.credentials), { headers: { 'X-API-Key': 'fixture-only-key' } });
  assert.equal(calls, 0);
  assert.ok(signatures >= 2, 'OAuth and setup must verify actual WebAuthn signatures');
  assert.ok(logs.every((line) => !line.includes('fixture-only-key') && !line.includes('amcpoa_')));
  assert.deepEqual(errors, []);
  console.log(`Setup verified: real OAuth/PKCE callback, WebAuthn consent, authenticated MCP discovery, secret-change invalidation, encrypted save, desktop/mobile. Screenshots: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'setup-failure.png'), fullPage: true }).catch(() => {});
    console.error('Fixture UI state:', await page.locator('body').innerText().catch(() => 'unavailable'));
  }
  throw error;
} finally {
  cancel.abort();
  await cli?.catch(() => {});
  await browser?.close();
  await app?.close();
  await mcp.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  await state.close();
  await rm(fixture, { recursive: true, force: true });
}
