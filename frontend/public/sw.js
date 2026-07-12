// Runs independently of any open tab — the browser keeps this alive in the background
// once registered, which is exactly what makes push notifications work with the app closed.

self.addEventListener('push', (event) => {
  let data = { title: 'MannaDash', body: 'You have a new update' };
  try {
    data = event.data.json();
  } catch {
    // Fall back to the default above if the payload isn't valid JSON for some reason
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  );
});

// Clicking the notification focuses an existing tab if one's open, otherwise opens a new one
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    }),
  );
});
