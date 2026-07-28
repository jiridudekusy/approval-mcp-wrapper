export declare class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string);
}
export declare function api<T>(path: string, init?: RequestInit, csrfToken?: string): Promise<T>;
//# sourceMappingURL=client.d.ts.map