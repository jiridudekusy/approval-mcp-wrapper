const supportStatus = document.querySelector('#support-status');
const subscribeButton = document.querySelector('#subscribe-button');
const unsubscribeButton = document.querySelector('#unsubscribe-button');
const subscriptionCount = document.querySelector('#subscription-count');
const notificationForm = document.querySelector('#notification-form');
const sendResult = document.querySelector('#send-result');
const refreshEventsButton = document.querySelector('#refresh-events');
const eventList = document.querySelector('#event-list');
const controlTokenInput = document.querySelector('#control-token');

let config;
let registration;

initialize().catch((error) => {
  supportStatus.textContent = error.message;
  supportStatus.classList.add('error');
});

subscribeButton.addEventListener('click', subscribe);
unsubscribeButton.addEventListener('click', unsubscribe);
notificationForm.addEventListener('submit', sendNotification);
refreshEventsButton.addEventListener('click', loadEvents);

async function initialize() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    subscribeButton.disabled = true;
    throw new Error('Tento prohlížeč nepodporuje potřebné Web Push API.');
  }

  config = await requestJson('/api/config');
  registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  subscriptionCount.textContent = formatDeviceCount(config.subscriptionCount);
  updateSubscriptionState(await registration.pushManager.getSubscription());
}

async function subscribe() {
  subscribeButton.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Oprávnění k notifikacím nebylo uděleno.');
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(config.vapidPublicKey),
      });
    }

    const result = await requestJson('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    subscriptionCount.textContent = formatDeviceCount(result.subscriptionCount);
    updateSubscriptionState(subscription);
  } catch (error) {
    supportStatus.textContent = error.message;
    supportStatus.classList.add('error');
    subscribeButton.disabled = false;
  }
}

async function unsubscribe() {
  unsubscribeButton.disabled = true;
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      const result = await requestJson('/api/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      subscriptionCount.textContent = formatDeviceCount(result.subscriptionCount);
    }
    updateSubscriptionState(null);
  } catch (error) {
    supportStatus.textContent = error.message;
    supportStatus.classList.add('error');
    unsubscribeButton.disabled = false;
  }
}

async function sendNotification(event) {
  event.preventDefault();
  sendResult.textContent = 'Odesílám…';
  sendResult.className = '';

  const actionRows = [...document.querySelectorAll('.action-row')];
  const actions = actionRows
    .map((row) => ({
      action: row.querySelector('.action-id').value.trim(),
      title: row.querySelector('.action-title').value.trim(),
    }))
    .filter((action) => action.action || action.title);

  try {
    const result = await requestJson('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${controlTokenInput.value}`,
      },
      body: JSON.stringify({
        title: document.querySelector('#title').value,
        body: document.querySelector('#body').value,
        image: document.querySelector('#image').value,
        detailMode: document.querySelector('#detail-mode').value,
        detailContent: document.querySelector('#detail-content').value,
        actions,
      }),
    });
    const failureDetails = result.results
      .filter((item) => !item.delivered)
      .map((item) => [item.statusCode, item.error].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(', ');
    sendResult.textContent = [
      `Doručeno ${result.delivered} z ${result.attempted}. ID ${result.messageId}`,
      failureDetails ? `Chyba: ${failureDetails}` : '',
    ].filter(Boolean).join(' · ');
    sendResult.className = result.failed ? 'warning' : 'success';
  } catch (error) {
    sendResult.textContent = error.message;
    sendResult.className = 'error';
  }
}

async function loadEvents() {
  eventList.textContent = 'Načítám…';
  try {
    const result = await requestJson('/api/events', {
      headers: { Authorization: `Bearer ${controlTokenInput.value}` },
    });
    if (result.events.length === 0) {
      eventList.className = 'empty-state';
      eventList.textContent = 'Zatím žádná akce.';
      return;
    }

    eventList.className = 'event-list';
    eventList.replaceChildren(
      ...result.events.map((item) => {
        const row = document.createElement('div');
        row.className = 'event-row';

        const action = document.createElement('strong');
        action.textContent = item.action;
        const meta = document.createElement('span');
        meta.textContent = `${new Date(item.at).toLocaleString()} · ${item.messageId}`;

        row.append(action, meta);
        return row;
      }),
    );
  } catch (error) {
    eventList.className = 'empty-state error';
    eventList.textContent = error.message;
  }
}

function updateSubscriptionState(subscription) {
  supportStatus.classList.remove('error');
  if (subscription) {
    supportStatus.textContent = 'Zařízení je přihlášené k Web Push.';
    subscribeButton.hidden = true;
    subscribeButton.disabled = false;
    unsubscribeButton.hidden = false;
    unsubscribeButton.disabled = false;
  } else {
    supportStatus.textContent = 'Web Push je podporovaný, zařízení zatím není přihlášené.';
    subscribeButton.hidden = false;
    subscribeButton.disabled = false;
    unsubscribeButton.hidden = true;
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error ?? `HTTP ${response.status}`);
  }
  return result;
}

function base64UrlToBytes(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function formatDeviceCount(count) {
  if (count === 1) return '1 zařízení';
  if (count >= 2 && count <= 4) return `${count} zařízení`;
  return `${count} zařízení`;
}
