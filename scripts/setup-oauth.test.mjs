import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import { authorizeSetup } from './setup-oauth.mjs';

it('completes S256 setup OAuth with a real loopback callback and does not log tokens', async () => {
  const origin = 'https://approval.example';
  const token = `amcpoa_${'t'.repeat(43)}`;
  const logs = [];
  let authorize;
  const result = await authorizeSetup({ server: origin, source: 'workspace', timeoutMs: 5000,
    log: (line) => logs.push(line),
    fetchImpl: async (url, init) => {
      assert.equal(init.redirect, 'error');
      if (url.endsWith('/.well-known/oauth-authorization-server')) return Response.json({ issuer: origin,
        scopes_supported: ['setup:submit'], authorization_endpoint: `${origin}/oauth/authorize`,
        registration_endpoint: `${origin}/oauth/register`, token_endpoint: `${origin}/oauth/token` });
      if (url.endsWith('/oauth/register')) return Response.json({ client_id: 'client' });
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('resource'), `${origin}/api/setup`);
      assert.equal(body.get('code'), 'approved-code');
      assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), authorize.searchParams.get('code_challenge'));
      return Response.json({ access_token: token, token_type: 'Bearer', scope: 'setup:submit' });
    },
    open: async (url) => {
      authorize = new URL(url);
      assert.equal(authorize.searchParams.get('scope'), 'setup:submit');
      const callback = new URL(authorize.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ state: 'wrong', iss: origin, code: 'spoof' }).toString();
      assert.equal((await fetch(callback)).status, 400);
      callback.search = new URLSearchParams({ state: authorize.searchParams.get('state'), iss: origin, code: 'approved-code' }).toString();
      assert.equal((await fetch(callback)).status, 200);
    },
  });
  assert.equal(result, token);
  assert.ok(logs.every((line) => !line.includes(token) && !line.includes('approved-code')));
});

it('rejects redirected/mismatched token endpoints before sending any authorization code', async () => {
  let calls = 0;
  await assert.rejects(authorizeSetup({ server: 'https://approval.example', source: 'x', timeoutMs: 1000,
    fetchImpl: async () => { calls++; return Response.json({ issuer: 'https://approval.example',
      token_endpoint: 'https://attacker.example/token' }); },
    open: async () => assert.fail('must not launch browser'),
  }));
  assert.equal(calls, 1);
});

it('handles denial and cleans up the callback listener', async () => {
  await assert.rejects(authorizeSetup({ server: 'https://approval.example', source: 'x', timeoutMs: 1000,
    fetchImpl: async (url) => Response.json(url.endsWith('/oauth/register') ? { client_id: 'client' } : {
      issuer: 'https://approval.example', scopes_supported: ['setup:submit'],
      authorization_endpoint: 'https://approval.example/oauth/authorize',
      registration_endpoint: 'https://approval.example/oauth/register', token_endpoint: 'https://approval.example/oauth/token',
    }),
    open: async (url) => {
      const authorize = new URL(url), callback = new URL(authorize.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ state: authorize.searchParams.get('state'), iss: 'https://approval.example', error: 'access_denied' }).toString();
      await fetch(callback);
    },
  }), /denied/);
});
