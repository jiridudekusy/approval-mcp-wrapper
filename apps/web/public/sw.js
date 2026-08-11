self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' ? payload.title : 'Approval MCP';
  const body = typeof payload.body === 'string'
    ? payload.body
    : 'A new request is waiting for approval.';
  const url = typeof payload.url === 'string' ? payload.url : '/';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'approval';
  const approvalId = typeof payload.approvalId === 'string'
    ? payload.approvalId
    : undefined;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    data: { url, approvalId },
    icon: '/app-icon.svg',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url;
  const rawApprovalId = event.notification.data?.approvalId;
  const target = new URL(typeof rawUrl === 'string' ? rawUrl : '/', self.location.origin);
  if (target.origin !== self.location.origin) target.href = self.location.origin;
  const approvalId = typeof rawApprovalId === 'string'
    ? rawApprovalId
    : target.pathname.match(/^\/approvals\/([^/]+)\/?$/)?.[1] ??
      target.searchParams.get('approval');
  const message = {
    type: 'approval-mcp:open-approval',
    approvalId,
  };
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        if ('navigate' in client) {
          const navigated = await client.navigate(target.href);
          if (navigated !== null) {
            navigated.postMessage(message);
            return navigated.focus();
          }
        }
      } catch {
        // Safari may reject navigation while still allowing focus and messages.
      }
      client.postMessage(message);
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
