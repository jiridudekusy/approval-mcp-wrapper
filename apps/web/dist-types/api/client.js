export class ApiError extends Error {
    status;
    code;
    constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
        this.name = 'ApiError';
    }
}
export async function api(path, init, csrfToken) {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined)
        headers.set('content-type', 'application/json');
    if (csrfToken !== undefined)
        headers.set('x-csrf-token', csrfToken);
    const response = await fetch(path, {
        ...init,
        headers,
        credentials: 'same-origin',
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => undefined));
        throw new ApiError(response.status, body?.error?.code ?? `http.${response.status}`);
    }
    return response.status === 204
        ? undefined
        : (await response.json());
}
//# sourceMappingURL=client.js.map