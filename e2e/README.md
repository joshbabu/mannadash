# End-to-End Test — Full Order Flow

Drives three real browsers simultaneously (customer, restaurant, rider) through the exact
cross-app flow we've manually tested by hand dozens of times: place an order, restaurant
accepts and prepares it, a rider delivers it, and the customer sees it update live at every
step — no page refresh, exactly like the real bugs we found and fixed earlier in this build.

## One-time setup

Each frontend needs to point at your **local** backend for this test, not production:

```bash
cd frontend && echo "VITE_API_BASE=http://localhost:3000" > .env.local
cd ../restaurant-dashboard && echo "VITE_API_BASE=http://localhost:3000" > .env.local
cd ../rider-app && echo "VITE_API_BASE=http://localhost:3000" > .env.local
```

Create a local test database (separate from your real dev data, same as the backend test setup):

```bash
createdb mannadash_test
psql -d mannadash_test -c "CREATE EXTENSION postgis;"
```

Install dependencies and the browser Playwright needs:

```bash
cd e2e
npm install
npx playwright install chromium
```

## Running it

```bash
npm test
```

Playwright automatically starts the backend and all three frontends for you (see
`playwright.config.ts`), runs the test, then shuts everything down.

## An honest note on verification

Every other piece of this project has been tested directly before being handed to you — real
API calls, real database checks, real socket tests. This one is different: the sandbox this was
built in can't reach Playwright's browser-download servers (a network restriction, same category
as the earlier AWS CLI `apt install` issue), so **this specific test has not actually been run**.

The code is written carefully against the real, verified button text and placeholders pulled
directly from each app's source — not guessed — but it needs a first real run on your machine
to confirm it passes. If a selector doesn't match (e.g., button text changes in the future),
Playwright's error message will show exactly which line and what it expected to find.
