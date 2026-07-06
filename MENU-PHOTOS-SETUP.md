# Menu Item Photos — Setup Guide

This feature needs a **second, PUBLIC** R2 bucket (separate from your private backups bucket)
since these images need to be viewable by anyone browsing the customer app.

## 1. Create a new R2 bucket

Cloudflare dashboard → R2 → Create bucket → name it `mannadash-menu-images`

## 2. Enable public access on this bucket (different from backups, which stays private)

Inside the bucket → Settings → look for "Public access" → enable it. Cloudflare will give you a
public URL like `https://pub-xxxxxxxx.r2.dev` — copy this, you'll need it below.

## 3. Reuse your existing R2 API token, or create a new one

Your existing backup token (Object Read & Write) should already work if it wasn't scoped to only
the backups bucket. If it was scoped narrowly, create a new token the same way as before, this
time selecting (or including) the `mannadash-menu-images` bucket.

## 4. Add these to your backend's `.env` on the server

```
R2_ACCOUNT_ID=<same account ID you used for backups>
R2_ACCESS_KEY_ID=<your R2 access key>
R2_SECRET_ACCESS_KEY=<your R2 secret key>
R2_MENU_IMAGES_BUCKET=mannadash-menu-images
R2_MENU_IMAGES_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev
```

(No trailing slash on the public URL.)

## 5. Redeploy the backend

```bash
cd /root/mannadash-app
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 6. Test it

Log into the restaurant dashboard, go to Menu, click "Add photo" on any item, pick an image.
If it works, you'll see the thumbnail appear immediately. Then check the customer app's menu
screen for that restaurant — the photo should show there too.

If it fails, the error message will tell you directly if the env vars aren't set correctly —
this was deliberately built to fail with a clear message rather than crash the whole backend.
