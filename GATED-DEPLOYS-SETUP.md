# Gated Deploys — Setup Guide

Backend and all four frontends now wait for both test suites (backend logic tests + the
cross-app e2e test) to pass before deploying anything, anywhere. Two one-time setup steps needed.

## 1. Create Cloudflare API credentials

**Account ID**: Cloudflare dashboard → any Pages project → right sidebar shows your Account ID
(also visible on the main Workers & Pages overview page). Copy it.

**API Token**: Cloudflare dashboard → click your profile icon (top right) → **My Profile** →
**API Tokens** → **Create Token** → use the **"Edit Cloudflare Pages"** template (or create a
custom token with **Account → Cloudflare Pages → Edit** permission). Copy the token — shown once.

## 2. Add both as GitHub secrets

**github.com/joshbabu/mannadash → Settings → Secrets and variables → Actions → New repository secret**

- `CLOUDFLARE_API_TOKEN` — the token from step 1
- `CLOUDFLARE_ACCOUNT_ID` — the account ID from step 1

## 3. Turn off Cloudflare's own automatic deploys (important!)

Without this, Cloudflare will keep deploying immediately on every push through its own webhook,
completely bypassing the new gate. For **each** of the four projects:

1. Project → **Settings** → **Branch control**
2. Find **Automatic deployments** → turn it **off**

Do this for `mannadash-customer`, `mannadash-restaurant`, `mannadash-rider`, and `mannadash-admin`.

## What happens now on every push

1. `test` and `e2e` jobs run (in parallel)
2. Only if **both** pass: `deploy-backend` and `deploy-frontends` run (also in parallel)
3. If either test suite fails, **nothing deploys** — backend or frontend

You can watch all of this in the **Actions** tab — one workflow run, showing all four jobs and
their dependencies clearly.
