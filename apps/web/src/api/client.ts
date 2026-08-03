export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export const AUTHENTICATION_LOST_EVENT = 'approval-mcp:unauthorized';

export function clearClientAuthentication(): void {
  if (globalThis.document === undefined) return;
  const secure = globalThis.location?.protocol === 'https:' ? '; Secure' : '';
  globalThis.document.cookie =
    `amcp_csrf=; Path=/; SameSite=Strict; Max-Age=0${secure}`;
}

export async function api<T>(
  path: string,
  init?: RequestInit,
  csrfToken?: string,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set('content-type', 'application/json');
  if (csrfToken !== undefined) headers.set('x-csrf-token', csrfToken);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/api/admin/')) {
      globalThis.dispatchEvent?.(new Event(AUTHENTICATION_LOST_EVENT));
    }
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string } }
      | undefined;
    throw new ApiError(
      response.status,
      body?.error?.code ?? `http.${response.status}`,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

export async function validateSession(): Promise<'anonymous' | 'authenticated'> {
  try {
    await api<{ authenticated: true }>('/api/auth/session');
    return 'authenticated';
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearClientAuthentication();
      return 'anonymous';
    }
    return 'authenticated';
  }
}
