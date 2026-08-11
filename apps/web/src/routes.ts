export type Page = 'access' | 'history' | 'inbox' | 'system' | 'upstreams';

export interface AppRoute {
  page: Page;
  approvalId?: string;
}

export const pagePaths: Record<Page, string> = {
  inbox: '/approvals',
  history: '/history',
  access: '/access',
  upstreams: '/upstreams',
  system: '/system',
};

function normalizedPathname(pathname: string): string {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '');
}

function decodedApprovalId(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function routeFromLocation(
  location: Pick<Location, 'pathname' | 'search'>,
): AppRoute {
  const pathname = normalizedPathname(location.pathname);
  const approvalMatch = /^\/approvals\/([^/]+)$/.exec(pathname);
  const approvalId = approvalMatch?.[1] === undefined
    ? undefined
    : decodedApprovalId(approvalMatch[1]);
  if (approvalId !== undefined) return { page: 'inbox', approvalId };

  const page = (Object.entries(pagePaths) as [Page, string][])
    .find(([, path]) => path === pathname)?.[0];
  if (page !== undefined) {
    const legacyApprovalId = page === 'inbox'
      ? new URLSearchParams(location.search).get('approval') ?? undefined
      : undefined;
    return legacyApprovalId === undefined
      ? { page }
      : { page, approvalId: legacyApprovalId };
  }

  const legacyApprovalId = new URLSearchParams(location.search).get('approval');
  return legacyApprovalId === null
    ? { page: 'inbox' }
    : { page: 'inbox', approvalId: legacyApprovalId };
}

export function routePath(route: AppRoute): string {
  if (route.page === 'inbox' && route.approvalId !== undefined) {
    return `${pagePaths.inbox}/${encodeURIComponent(route.approvalId)}`;
  }
  return pagePaths[route.page];
}
