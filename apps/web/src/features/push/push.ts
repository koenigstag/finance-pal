/**
 * The browser's half of push notifications: permission, the subscription a push service hands
 * out, and the bytes the two spell keys in.
 *
 * Nothing here talks to the API — see queries.ts for that. The split matters because the two can
 * disagree: a browser can hold a subscription the API has never been told about, or has since
 * forgotten. What the API holds is what actually gets sent to, so that is what the settings
 * switch reflects; this file only ever reports what the browser has.
 */

/** What the API needs in order to send to this device. */
export interface DeviceRegistration {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Whether this browser can do push at all. Notably false on iOS until the app has been added to
 * the home screen — Safari only offers push to an installed web app — and in a development
 * server, which registers no service worker.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** 'granted', 'denied', 'default' — or null where push isn't supported at all. */
export function notificationPermission(): NotificationPermission | null {
  return isPushSupported() ? Notification.permission : null;
}

/**
 * Asks, once. A browser that has already been told never to ask again answers 'denied' without
 * showing anything, which is why the card offers to open browser settings instead of asking twice.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) {
    return 'denied';
  }
  return Notification.requestPermission();
}

/** What this browser is registered as right now, if anything. */
export async function currentRegistration(): Promise<DeviceRegistration | null> {
  const subscription = await currentSubscription();
  return subscription ? toRegistration(subscription) : null;
}

/**
 * Registers this browser with its push service, or hands back the registration it already has.
 * Null when push isn't available, the permission wasn't given, or no service worker is running —
 * the last being the ordinary state of `nx dev`, where there is no worker to receive anything.
 */
export async function registerDevice(publicKey: string): Promise<DeviceRegistration | null> {
  const registration = await serviceWorkerRegistration();
  if (!registration || Notification.permission !== 'granted') {
    return null;
  }

  const existing = await registration.pushManager.getSubscription();
  // A subscription made against a key the API no longer uses can't be sent to, and nothing about
  // it would say so: it is dropped and made again rather than quietly never arriving.
  if (existing && !matchesServerKey(existing, publicKey)) {
    await existing.unsubscribe();
  } else if (existing) {
    return toRegistration(existing);
  }

  const subscription = await registration.pushManager.subscribe({
    // Required by browsers, and true of every notification this app sends: each one is shown.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return toRegistration(subscription);
}

/** Drops this browser's subscription and returns the endpoint it had, for telling the API. */
export async function forgetDevice(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) {
    return null;
  }
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

/** Whether a subscription was made against the key the API is sending with now. */
export function matchesServerKey(subscription: PushSubscription, publicKey: string): boolean {
  const applied = subscription.options?.applicationServerKey;
  if (!applied) {
    // An older browser that doesn't report it: nothing to go on, so take it as it is rather than
    // dropping a working subscription on a guess.
    return true;
  }
  const actual = new Uint8Array(applied);
  const expected = urlBase64ToUint8Array(publicKey);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

/**
 * The VAPID public key as `pushManager.subscribe` wants it. The API sends it base64url, the way
 * every push library writes keys; the browser takes bytes.
 */
export function urlBase64ToUint8Array(base64UrlKey: string): Uint8Array<ArrayBuffer> {
  const padded = base64UrlKey + '='.repeat((4 - (base64UrlKey.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  // Backed by a plain ArrayBuffer, which is what subscribe() takes — the shared-memory kind a
  // bare Uint8Array may also hold is not a BufferSource.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Null for a subscription without both keys, which nothing could be encrypted to. */
export function toRegistration(subscription: PushSubscription): DeviceRegistration | null {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.['p256dh'] || !keys?.['auth']) {
    return null;
  }
  return { endpoint, keys: { p256dh: keys['p256dh'], auth: keys['auth'] } };
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await serviceWorkerRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// getRegistration(), not ready: `ready` never settles where no worker was ever registered, which
// is every development server run.
async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) {
    return null;
  }
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}
