import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, 'public');
const dataRoot = join(root, '.poc-data');
const vapidPath = join(dataRoot, 'vapid.json');
const subscriptionsPath = join(dataRoot, 'subscriptions.json');

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const adminToken = process.env.POC_TOKEN ?? randomBytes(18).toString('base64url');
const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:web-push-poc@example.com';

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

await mkdir(dataRoot, { recursive: true });

const vapid = await loadOrCreateVapidKeys();
const subscriptions = await loadSubscriptions();
const events = [];

webpush.setVapidDetails(vapidSubject, vapid.publicKey, vapid.privateKey);

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Unexpected PoC server error' });
  }
});

server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`\nWeb Push PoC: http://${displayHost}:${port}`);
  console.log(`Control token: ${adminToken}`);
  console.log(`Stored subscriptions: ${subscriptions.size}`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.log('The server listens outside localhost. Put it behind trusted HTTPS before using an iPhone.');
  }
  console.log('');
});

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/config') {
    sendJson(response, 200, {
      vapidPublicKey: vapid.publicKey,
      subscriptionCount: subscriptions.size,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/subscriptions') {
    const body = await readJson(request);
    if (!isSubscription(body)) {
      sendJson(response, 400, { error: 'Invalid push subscription' });
      return;
    }

    subscriptions.set(body.endpoint, body);
    await saveSubscriptions();
    sendJson(response, 201, { ok: true, subscriptionCount: subscriptions.size });
    return;
  }

  if (request.method === 'DELETE' && url.pathname === '/api/subscriptions') {
    const body = await readJson(request);
    if (typeof body?.endpoint !== 'string') {
      sendJson(response, 400, { error: 'Missing subscription endpoint' });
      return;
    }

    subscriptions.delete(body.endpoint);
    await saveSubscriptions();
    sendJson(response, 200, { ok: true, subscriptionCount: subscriptions.size });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/send') {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: 'Invalid control token' });
      return;
    }

    const body = await readJson(request);
    const notification = normalizeNotification(body);
    if (!notification.ok) {
      sendJson(response, 400, { error: notification.error });
      return;
    }

    const messageId = randomBytes(9).toString('base64url');
    const payload = JSON.stringify({
      messageId,
      notification: notification.value,
    });

    const deliveryResults = await Promise.all(
      [...subscriptions.values()].map(async (subscription) => {
        try {
          await webpush.sendNotification(subscription, payload, {
            TTL: 120,
            urgency: 'high',
          });
          return { endpoint: subscription.endpoint, delivered: true };
        } catch (error) {
          const statusCode = Number(error?.statusCode ?? 0);
          const providerReason = readProviderReason(error?.body);
          if (statusCode === 404 || statusCode === 410) {
            subscriptions.delete(subscription.endpoint);
          }
          return {
            endpoint: subscription.endpoint,
            delivered: false,
            statusCode: statusCode || undefined,
            error: providerReason ?? (error instanceof Error ? error.message : String(error)),
          };
        }
      }),
    );

    await saveSubscriptions();
    sendJson(response, 200, {
      messageId,
      attempted: deliveryResults.length,
      delivered: deliveryResults.filter((result) => result.delivered).length,
      failed: deliveryResults.filter((result) => !result.delivered).length,
      results: deliveryResults.map(({ endpoint, ...result }) => ({
        endpointHash: hashEndpoint(endpoint),
        ...result,
      })),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/events') {
    const body = await readJson(request);
    if (
      typeof body?.messageId !== 'string' ||
      typeof body?.action !== 'string' ||
      body.messageId.length > 100 ||
      body.action.length > 100
    ) {
      sendJson(response, 400, { error: 'Invalid click event' });
      return;
    }

    events.unshift({
      messageId: body.messageId,
      action: body.action,
      at: new Date().toISOString(),
    });
    events.splice(50);
    sendJson(response, 202, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/events') {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: 'Invalid control token' });
      return;
    }
    sendJson(response, 200, { events });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

function normalizeNotification(input) {
  if (input === null || typeof input !== 'object') {
    return { ok: false, error: 'Notification must be an object' };
  }

  const title = cleanString(input.title, 100);
  const body = cleanString(input.body, 300);
  const image = cleanOptionalUrl(input.image);
  const detailMode = ['text', 'json', 'key-value'].includes(input.detailMode)
    ? input.detailMode
    : 'text';
  const detailContent = cleanString(input.detailContent, 1_500);

  if (!title) {
    return { ok: false, error: 'Title is required' };
  }
  if (input.image && !image) {
    return { ok: false, error: 'Image must be an HTTPS URL' };
  }

  const rawActions = Array.isArray(input.actions) ? input.actions : [];
  if (rawActions.length > 3) {
    return { ok: false, error: 'The PoC supports at most three actions' };
  }

  const actions = [];
  const actionIds = new Set();
  for (const item of rawActions) {
    const action = cleanActionId(item?.action);
    const label = cleanString(item?.title, 32);
    if (!action || !label) {
      return { ok: false, error: 'Every action needs a valid ID and label' };
    }
    if (actionIds.has(action)) {
      return { ok: false, error: 'Action IDs must be unique' };
    }
    actionIds.add(action);
    actions.push({ action, title: label });
  }

  return {
    ok: true,
    value: {
      title,
      body,
      ...(image ? { image } : {}),
      actions,
      data: {
        detailMode,
        detailContent,
      },
    },
  };
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanActionId(value) {
  const candidate = cleanString(value, 40);
  return /^[a-z0-9][a-z0-9_-]*$/i.test(candidate) ? candidate : '';
}

function cleanOptionalUrl(value) {
  const candidate = cleanString(value, 500);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function isSubscription(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.endpoint === 'string' &&
    value.endpoint.startsWith('https://') &&
    value.keys !== null &&
    typeof value.keys === 'object' &&
    typeof value.keys.p256dh === 'string' &&
    typeof value.keys.auth === 'string'
  );
}

function isAuthorized(request) {
  const header = request.headers.authorization ?? '';
  const expected = `Bearer ${adminToken}`;
  const actualBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(response, rawPathname) {
  const pathname = rawPathname === '/' ? '/index.html' : decodeURIComponent(rawPathname);
  const candidate = resolve(publicRoot, `.${pathname}`);
  if (!candidate.startsWith(`${publicRoot}/`) && candidate !== publicRoot) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  try {
    const content = await readFile(candidate);
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(extname(candidate)) ?? 'application/octet-stream',
      'Cache-Control': pathname === '/sw.js' ? 'no-cache' : 'no-store',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; manifest-src 'self'; script-src 'self'; style-src 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...(pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    response.end(content);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    throw error;
  }
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function loadOrCreateVapidKeys() {
  try {
    const stored = JSON.parse(await readFile(vapidPath, 'utf8'));
    if (typeof stored.publicKey === 'string' && typeof stored.privateKey === 'string') {
      return stored;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const generated = webpush.generateVAPIDKeys();
  await atomicWrite(vapidPath, JSON.stringify(generated, null, 2));
  return generated;
}

async function loadSubscriptions() {
  try {
    const stored = JSON.parse(await readFile(subscriptionsPath, 'utf8'));
    return new Map(
      (Array.isArray(stored) ? stored : [])
        .filter(isSubscription)
        .map((subscription) => [subscription.endpoint, subscription]),
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map();
    throw error;
  }
}

async function saveSubscriptions() {
  await atomicWrite(subscriptionsPath, JSON.stringify([...subscriptions.values()], null, 2));
}

async function atomicWrite(path, content) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, content, { mode: 0o600 });
  await rename(temporaryPath, path);
}

function hashEndpoint(endpoint) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 12);
}

function readProviderReason(body) {
  if (typeof body !== 'string' || !body) return undefined;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed.reason === 'string' ? parsed.reason : undefined;
  } catch {
    return undefined;
  }
}
