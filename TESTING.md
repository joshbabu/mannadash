# Automated Testing

## What's covered

`backend/test/*.e2e-spec.ts` — real tests that boot the actual backend and hit real endpoints,
covering the exact bugs we found by hand during development:

- **Order lifecycle authority** (`order-lifecycle.e2e-spec.ts`) — a restaurant cannot mark its own
  order "picked up" or "delivered"; a rider cannot mark "accepted" or "preparing"; a customer
  cannot view another customer's order; the full happy path from placed to delivered works.
- **Ratings** (`ratings.e2e-spec.ts`) — can't rate before delivery, can't rate the same order
  twice, two ratings correctly average together, non-admins can't run the ratings backfill.

## Running tests locally

You'll need a separate test database (never run tests against your real dev or production data):

```bash
createdb mannadash_test
psql -d mannadash_test -c "CREATE EXTENSION postgis;"
```

Then, from the `backend` folder:

```bash
DB_HOST=localhost DB_PORT=5432 DB_USERNAME=app DB_PASSWORD=<your local db password> \
DB_NAME=mannadash_test JWT_SECRET=test_secret ADMIN_USERNAME=admin ADMIN_PASSWORD=test_admin \
npm run test:e2e -- --runInBand
```

## What happens on every push now

`.github/workflows/deploy-backend.yml` runs these tests automatically in a completely fresh,
temporary environment (a throwaway Postgres container inside GitHub Actions — never your real
database) before it ever attempts to deploy. If any test fails, the deploy step is skipped
entirely — broken logic never reaches your live server.

## What this does and doesn't catch

**Does catch:** backend logic bugs — permission/ownership mistakes, incorrect business math,
broken validation.

**Doesn't catch:** frontend rendering bugs, infrastructure/deployment issues, or anything visual.
Those still need manual testing or separate tooling.

## Keeping this valuable over time

Every new backend feature should get a matching test. An untested test suite that never grows
gives false confidence — the value here comes from keeping it current, not from having written
it once.
