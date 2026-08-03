import { afterEach, describe, expect, it, vi } from 'vitest';

describe('application logout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('finishes local logout when the server is unavailable', async () => {
    const shell = (await import('./app-shell.js')) as typeof import('./app-shell.js') & {
      logoutSession?: (csrfToken: string, onLogout: () => void) => Promise<void>;
    };
    expect(shell.logoutSession).toBeTypeOf('function');
    if (shell.logoutSession === undefined) return;

    let cookieWrite = '';
    vi.stubGlobal('document', {
      cookie: '',
      set cookie(value: string) {
        cookieWrite = value;
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const onLogout = vi.fn();

    await expect(shell.logoutSession('csrf-token', onLogout)).resolves.toBeUndefined();

    expect(onLogout).toHaveBeenCalledOnce();
    expect(cookieWrite).toContain('amcp_csrf=');
    expect(cookieWrite).toContain('Max-Age=0');
  });
});
