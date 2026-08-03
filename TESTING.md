# Automated Testing

## The standing rule going forward

**Every new feature — frontend or backend — gets a matching test at the same time it's built.**
Not as cleanup later, not "if there's time." A feature without a test is treated as unfinished.

- New backend logic (a new endpoint, a permission rule, a calculation) → add to
  `backend/test/*.e2e-spec.ts`
- New cross-app UI flow (something a user clicks through spanning multiple apps) → extend
  `e2e/tests/order-flow.spec.ts` or add a new spec file in `e2e/tests/`

## What's covered right now

**Backend** (`backend/test/*.e2e-spec.ts` + `backend/src/**/*.spec.ts`, 35 e2e suites / ~295
tests + 2 unit suites / 6 tests, all run for real against Postgres+PostGIS — not just `tsc`):
- Order lifecycle authority — restaurant vs rider vs customer permission boundaries
- Ratings math, admin gating; operating hours enforcement; cancellation/refund tracking
- Push notification subscription auth
- Tax invoice generation — real invoice numbering, real restaurant KYC passthrough, honest
  placeholders for genuinely-missing data, safe migration onto a table with existing rows
- Rider programs — shifts (with real DB-level double-booking prevention), incentives (real
  progress computed from actual delivered orders, never faked), announcements, referrals
  (real codes, real per-referee progress), SOS alerts, bank details (self-service,
  `@Exclude()`-protected), rider navigation coordinates (real `ST_X`/`ST_Y` extraction)
- Saved addresses — full CRUD, `addressDetails`, receiver name/phone, partial-update
  semantics, restaurant location self-correction flowing through to a rider's Navigate button
- Nearby-restaurant search radius (15km, matching Swiggy/Zomato's general range) and the
  distance-tiered delivery fee schedule, both with real Hyderabad coordinates, not made-up ones
- Delivery fee formula tested as a pure unit test (`delivery-fee.util.spec.ts`) — geodesic
  test-helper imprecision made an exact e2e assertion at a boundary value unreliable, so the
  formula itself gets tested directly instead

Read the spec files directly — they're written to be readable as documentation of the rules
themselves.

**Frontend / cross-app** (`e2e/tests/*.spec.ts`, 4 files, 13 top-level tests, several with
multiple `test.step()`s):
- The complete order flow across all three apps: customer orders, restaurant accepts/prepares/
  assigns, rider delivers, customer sees every update live with no refresh
- Customer cancelling their own order via the real Cancel button
- Logout across all three apps; restaurant onboarding
- Address picker: add via map, search-to-save (not an instant unsaved selection), manual pin
  placement, typing a full address with real geocode-or-honest-fallback, unified add/edit form,
  a failed geocode search showing a real error instead of silence, and the checkout-carries-the-
  selected-address regression (checkout used to always restart at a hardcoded default)

**Not yet covered** (fair game for "add a test when you touch this next"): ratings submission,
the live map (needs real multi-app geolocation-permission choreography that doesn't fit cleanly
into the existing suite), insights calculations, menu photo upload, the rider app's Earnings/
Shifts/Refer/SOS screens end-to-end through a real browser (backend logic for all of these is
covered; the rider-app UI itself isn't yet in the Playwright suite).

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

**A real example of this happening**: cancellation and refund tracking were built, manually
verified working correctly (including live on production), and shipped — without automated tests
for the refund-completion logic or the actual Cancel button in the UI. That's exactly the gap
this policy exists to prevent. Both gaps were caught and closed the same day, but the lesson
stands: manual verification, however thorough, is not a substitute for the automated test — it
only proves the feature worked *once*, for the person who happened to click through it.

**A second example, different lesson**: a real production bug (photo uploads rejected with
"request entity too large") was fixed in `main.ts`, and a test was written for it immediately —
which then itself failed, because `test-helpers.ts` bootstraps the test app separately from
`main.ts` and didn't apply the same fix. The test caught a real gap in the test environment
itself, not just the original bug. Any new middleware/config added to `main.ts` needs the same
change mirrored in `createTestApp()`, or tests can pass while quietly testing against
production-inaccurate behavior.
