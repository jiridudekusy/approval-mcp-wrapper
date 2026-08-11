self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  const notification = payload.notification ?? {};
  const options = {
    body: notification.body ?? '',
    data: {
      messageId: payload.messageId ?? 'unknown',
      detailMode: notification.data?.detailMode ?? 'text',
      detailContent: notification.data?.detailContent ?? '',
    },
    actions: Array.isArray(notification.actions) ? notification.actions : [],
    tag: `web-push-poc-${payload.messageId ?? Date.now()}`,
    renotify: true,
  };

  if (notification.image) {
    options.image = notification.image;
  }

  event.waitUntil(
    self.registration.showNotification(notification.title ?? 'Web Push PoC', options),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data ?? {};
  const action = event.action || 'open';
  const parameters = new URLSearchParams({
    action,
    messageId: data.messageId ?? 'unknown',
    mode: data.detailMode ?? 'text',
    content: data.detailContent ?? '',
  });
  const destination = `/result.html?${parameters}`;

  event.waitUntil(
    Promise.allSettled([
      fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: data.messageId ?? 'unknown', action }),
      }),
      focusOrOpen(destination),
    ]),
  );
});

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { notification: { title: 'Web Push PoC', body: event.data.text() } };
  }
}

async function focusOrOpen(destination) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
  if (existing) {
    await existing.navigate(destination);
    return existing.focus();
  }
  return self.clients.openWindow(destination);
}
