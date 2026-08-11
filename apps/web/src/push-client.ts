export type PushCapability =
  | 'available'
  | 'install_required'
  | 'unavailable';

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isIos(): boolean {
  const userAgent = globalThis.navigator?.userAgent ?? '';
  return /iPad|iPhone|iPod/.test(userAgent) ||
    (globalThis.navigator?.platform === 'MacIntel' &&
      (globalThis.navigator?.maxTouchPoints ?? 0) > 1);
}

export function pushCapability(): PushCapability {
  const navigatorValue = globalThis.navigator as
    | NavigatorWithStandalone
    | undefined;
  if (isIos() && navigatorValue?.standalone !== true) {
    return 'install_required';
  }
  return globalThis.isSecureContext &&
    'serviceWorker' in (navigatorValue ?? {}) &&
    'PushManager' in globalThis &&
    'Notification' in globalThis
    ? 'available'
    : 'unavailable';
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function defaultPushDeviceName(): string {
  const userAgent = globalThis.navigator?.userAgent ?? '';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/iPhone|iPod/.test(userAgent)) return 'iPhone';
  if (/Mac/.test(userAgent)) return 'Mac';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows/.test(userAgent)) return 'Windows PC';
  if (/Linux/.test(userAgent)) return 'Linux device';
  return 'Browser device';
}

export function pushPlatform(): string {
  return globalThis.navigator?.platform || defaultPushDeviceName();
}

export async function subscribeToPush(
  publicKey: string,
): Promise<PushSubscription> {
  const registration = await globalThis.navigator.serviceWorker.register('/sw.js');
  await globalThis.navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  const expectedKey = base64UrlBytes(publicKey);
  if (current !== null) {
    const currentKey = current.options.applicationServerKey;
    const currentBytes = currentKey === null
      ? undefined
      : new Uint8Array(currentKey);
    const matches = currentBytes?.byteLength === expectedKey.byteLength &&
      currentBytes.every((byte, index) => byte === expectedKey[index]);
    if (matches) return current;
    await current.unsubscribe();
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: expectedKey,
  });
}

export function serializePushSubscription(subscription: PushSubscription): {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
} {
  const value = subscription.toJSON();
  const p256dh = value.keys?.['p256dh'];
  const auth = value.keys?.['auth'];
  if (typeof p256dh !== 'string' || typeof auth !== 'string') {
    throw new Error('The browser returned an incomplete push subscription');
  }
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh, auth },
  };
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in globalThis.navigator)) return null;
  const registration = await globalThis.navigator.serviceWorker.getRegistration('/');
  return registration?.pushManager.getSubscription() ?? null;
}

export async function hashPushEndpoint(endpoint: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(endpoint),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
