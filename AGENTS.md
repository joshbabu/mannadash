# AGENTS.md

## Cursor Cloud specific instructions

This repo ("MannaDash" food‑delivery platform) is a multi-app project with one shared
NestJS backend + Postgres/PostGIS database and four Vite/React frontends. See
`PROJECT-STATUS.md`, `TESTING.md`, and `e2e/README.md` for product/testing detail; standard
per-package commands live in each `package.json`.

### Services and ports

| Service | Dir | Dev command | Port |
| --- | --- | --- | --- |
| Backend API + Socket.IO | `backend` | `npm run start:dev` | 3000 |
| Customer app | `frontend` | `npm run dev -- --port 5173` | 5173 |
| Restaurant dashboard | `restaurant-dashboard` | `npm run dev -- --port 5174` | 5174 |
| Rider app | `rider-app` | `npm run dev -- --port 5175` | 5175 |
| Admin panel | `admin-panel` | `npm run dev -- --port 5176` | 5176 |

### Database (must be started manually)

PostgreSQL 16 + PostGIS 3.4 is installed at the system level (not via Docker here — the
committed `docker-compose.yml` is an alternative). It is **not running on a fresh VM boot** —
start it before running the backend or any tests:

```
sudo pg_ctlcluster 16 main start
```

Two databases already exist (role `app` / password `app_local_dev_password`, both with the
`postgis` extension): `hyd_food_delivery` (dev, used by `npm run start:dev`) and
`mannadash_test` (used by the automated tests). TypeORM `synchronize: true` auto-creates the
schema on backend start, so there is no migration step.

### Required env files (untracked, created during setup — recreate if missing)

- `backend/.env` — copy from `backend/.env.example`; set `JWT_SECRET` and `ADMIN_PASSWORD`.
  Third‑party keys (Razorpay, R2, VAPID, Unsplash) are optional and fail soft when blank.
- `frontend/.env.local`, `restaurant-dashboard/.env.local`, `rider-app/.env.local`,
  `admin-panel/.env.local` — each just needs `VITE_API_BASE=http://localhost:3000` (see the
  `.env.local.example` files). Without these the frontends default to the production URL.

### Testing caveats

- Backend API tests: run from `backend` with `DB_NAME=mannadash_test` (plus the other `DB_*`,
  `JWT_SECRET`, `ADMIN_*` env vars) — `npm run test:e2e -- --runInBand`.
- Playwright cross-app suite (`e2e/`, `npm test`) launches **its own** backend on port 3000 with
  `reuseExistingServer: false`, and reuses frontends on 5173–5176 if already up. Free port 3000
  first (stop the dev backend) or the suite will fail to bind. It needs `DB_*` env pointing at
  `mannadash_test`.
- `backend`'s `npm run lint` currently reports many pre‑existing errors (mostly `any` in test
  files); this is the committed state, not an environment problem. Frontend `npm run lint`
  (oxlint) is clean apart from warnings.
