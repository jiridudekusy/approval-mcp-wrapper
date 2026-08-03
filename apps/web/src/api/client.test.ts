import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './client.js';

function errorResponse(status: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: status === 401 ? 'auth.unauthorized' : 'auth.csrf_invalid',
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

describe('API authentication handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('signals authentication loss for an admin API 401', async () => {
    const dispatchEvent = vi.fn(() => true);
    vi.stubGlobal('dispatchEvent', dispatchEvent);
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(401)));

    await expect(api('/api/admin/system')).rejects.toEqual(
      expect.objectContaining<ApiError>({ status: 401 }),
    );

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: 'approval-mcp:unauthorized',
    });
  });

  it.each([
    ['/api/auth/recovery', 401],
    ['/api/admin/system', 403],
  ])('does not signal authentication loss for %s with %s', async (path, status) => {
    const dispatchEvent = vi.fn(() => true);
    vi.stubGlobal('dispatchEvent', dispatchEvent);
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(status)));

    await expect(api(path)).rejects.toBeInstanceOf(ApiError);

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('maps session validation to authenticated or anonymous without treating network failure as logout', async () => {
    const client = (await import('./client.js')) as typeof import('./client.js') & {
      validateSession?: () => Promise<'anonymous' | 'authenticated'>;
    };
    expect(client.validateSession).toBeTypeOf('function');
    if (client.validateSession === undefined) return;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(client.validateSession()).resolves.toBe('authenticated');

    let cookieWrite = '';
    vi.stubGlobal('document', {
      cookie: '',
      set cookie(value: string) {
        cookieWrite = value;
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(401)));
    await expect(client.validateSession()).resolves.toBe('anonymous');
    expect(cookieWrite).toContain('amcp_csrf=');
    expect(cookieWrite).toContain('Max-Age=0');

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    await expect(client.validateSession()).resolves.toBe('authenticated');
  });
});
