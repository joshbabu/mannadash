import { api } from '../api';

// PushManager needs the VAPID key as a Uint8Array, but our backend hands it back as a
// base64url string — this converts between the two.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

// The browser remembers permission decisions permanently — checking this on load means we never
// show "Enable notifications" again once someone's already said yes (or no) previously.
export function getInitialPushStatus() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission === 'granted' ? 'enabled' : 'idle';
}

// Called silently on load when permission's already granted — re-confirms the subscription is
// actually saved on the backend (it can go stale across sessions/devices), with no visible UI.
export async function silentlyRefreshSubscription() {
  if (Notification.permission !== 'granted') return;
  try {
    await enablePushNotifications();
  } catch {
    // Best-effort only — permission is already granted either way, so no need to alarm the user
    // if this background refresh fails; it'll just retry next time the app loads.
  }
}

/**
 * Full subscribe flow: register the service worker, ask for notification permission, subscribe
 * with the browser's push service, then save that subscription on the backend. Safe to call
 * multiple times — the backend replaces any existing subscription rather than duplicating it.
 */
export async function enablePushNotifications() {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported on this browser');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted');
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const { publicKey } = await api.getVapidPublicKey();
  if (!publicKey) {
    throw new Error('Push notifications are not configured on the server yet');
  }

  // Critical: pushManager.subscribe() does NOT automatically replace an existing
  // subscription when called with a different applicationServerKey — browsers generally
  // just hand back the old one, silently ignoring the new key entirely. If the server's
  // VAPID key is ever rotated (as happened here — the original key pair turned out to be
  // malformed), every existing subscriber needs their OLD subscription explicitly torn
  // down first, or "re-enabling" notifications does nothing but resave the same stale,
  // now-invalid subscription. This bit us in production: BadJwtToken kept firing even
  // after generating a fresh, correctly-matched key pair, because the browser never
  // actually created a new subscription against it.
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await existing.unsubscribe();
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await api.subscribeToPush(subscription.toJSON());
  return true;
}

/**
 * L5: the actual opt-out. Same two-part teardown as the other apps — browser subscription,
 * then backend record. Worth being especially clear about this one for riders specifically:
 * turning this off means missing the "New delivery!" push entirely if the app isn't open,
 * which is a real, meaningful thing to opt out of, not a minor preference.
 */
export async function disablePushNotifications() {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }
  }
  await api.unsubscribeFromPush();
  return true;
}
