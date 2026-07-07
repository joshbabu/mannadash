# Push Notifications — Setup Guide

Riders now get real push notifications for new deliveries — these arrive even if their browser
tab is closed, as long as the browser itself is running. Restaurant new-order push notifications
are wired on the backend too; only the rider app's frontend subscribe flow is built so far (the
restaurant dashboard follows the exact same pattern — a good next addition when you're ready).

## 1. Generate your own VAPID key pair

**Never reuse keys shown in any tutorial, chat, or documentation — generate your own.**

On your server:

```bash
cd /root/mannadash-app/backend
npx web-push generate-vapid-keys
```

This prints a public and private key pair.

## 2. Add both to your backend's `.env`

```
VAPID_PUBLIC_KEY=<the public key>
VAPID_PRIVATE_KEY=<the private key>
```

## 3. Redeploy the backend

```bash
cd /root/mannadash-app
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 4. Test it

1. Open the rider app, log in
2. You should see a new card: "Get notified of new deliveries even when this app is closed" with
   an **Enable notifications** button
3. Click it — your browser will ask for notification permission, click **Allow**
4. Close the rider app's tab entirely (not just switch tabs — actually close it)
5. From another device/browser, place an order and get it assigned to this rider (accept →
   prepare → auto-assign)
6. You should see a real OS-level notification appear, even with the tab closed

## Known limitations

- **iOS Safari**: web push support on iOS requires the app to be "installed" (added to home
  screen) — a plain browser tab won't receive background push notifications there, this is an
  Apple platform restriction, not something we can work around in code.
- **Restaurant dashboard**: backend is ready (the same `sendToSubscriber` call already fires on
  every new order), but the frontend subscribe flow (service worker + Enable button) hasn't been
  built for that app yet — copy the pattern from `rider-app/src/utils/pushNotifications.js` and
  `rider-app/public/sw.js` when you're ready to add it there.
