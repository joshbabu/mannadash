# Automated Testing

## The standing rule going forward

**Every new feature — frontend or backend — gets a matching test at the same time it's built.**
Not as cleanup later, not "if there's time." A feature without a test is treated as unfinished.

- New backend logic (a new endpoint, a permission rule, a calculation) → add to
  `backend/test/*.e2e-spec.ts`
- New cross-app UI flow (something a user clicks through spanning multiple apps) → extend
  `e2e/tests/order-flow.spec.ts` or add a new spec file in `e2e/tests/`

## What's covered right now

**Backend** (`backend/test/*.e2e-spec.ts`, 16 tests across 4 files):
- Order lifecycle authority — restaurant vs rider vs customer permission boundaries
- Ratings math, admin gating
- Operating hours enforcement, customer-initiated cancellation window, rider payout tracking
- Push notification subscription auth

Read the spec files directly — they're written to be readable as documentation of the rules
themselves.

**Frontend / cross-app** (`e2e/tests/order-flow.spec.ts`) — the complete order flow across all
three apps: customer orders, restaurant accepts/prepares/assigns, rider delivers, customer sees
every update live with no refresh.

**Not yet covered** (fair game for "add a test when you touch this next"): ratings submission,
the live map, saved addresses/reorder, insights calculations, menu photo upload.

## Seeing results

**In your terminal** — pass/fail counts and error details, same as you've already seen.

**As a visual report** (Playwright only) — after running `npm test` in `e2e/`, run:
```bash
npx playwright show-report
```
Opens a browsable page: each step of the test, and for any failure, a screenshot and full replay
trace of exactly what the browser saw.

**In GitHub Actions** — both suites now run automatically on every relevant push:
- `.github/workflows/deploy-backend.yml` — backend tests, gates the actual deploy
- `.github/workflows/e2e-test.yml` — the full cross-app test, runs independently

Unlike the sandbox this was originally built in, GitHub Actions has full internet access, so it
can install and run a real browser — meaning the e2e test gets a genuine automated result on
every push, not just when you happen to run it locally. Check the **Actions** tab on GitHub; a
failed e2e run also uploads its HTML report as a downloadable artifact.

## Running tests locally

**Backend tests** — you'll need a separate test database (never run against real dev/production data):

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

**Cross-app e2e test** — see `e2e/README.md` for the full one-time setup (the `.env.local` files
each frontend needs, installing the browser, etc.).

## What this does and doesn't catch

**Does catch:** backend logic bugs (permission/ownership mistakes, incorrect business math,
broken validation), and cross-app functional flow bugs (a button that doesn't work, a live update
that never arrives, an app silently talking to the wrong backend).

**Doesn't catch:** purely visual bugs — colors, spacing, text that's technically present but
unreadable against its background (exactly the kind of bug we found by eye earlier in this
project). That needs either careful manual review or a separate visual-regression tool, neither
of which is set up yet.

## Keeping this valuable over time

An untested feature, or a test suite that stops growing, gives false confidence — worse than no
tests at all, since it looks like safety without actually being safety. The value here comes
entirely from keeping both suites current as the product grows, not from having written them once.
