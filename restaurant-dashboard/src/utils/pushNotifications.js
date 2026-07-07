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

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await api.subscribeToPush(subscription.toJSON());
  return true;
}
