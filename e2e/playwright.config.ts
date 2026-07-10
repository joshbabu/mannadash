import { defineConfig } from '@playwright/test';

/**
 * Runs the full stack locally (never against production) and drives real browsers through
 * the core cross-app flow: customer orders, restaurant accepts, rider delivers.
 *
 * Each frontend needs a `.env.local` pointing VITE_API_BASE at http://localhost:3000 —
 * see e2e/README.md for the one-time setup.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false, // the flow is inherently sequential across three simultaneous sessions
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // 'on' = record the full trace for every run, pass or fail — so the CI report always
    // has the step-by-step drill-down (each assertion, with DOM snapshots) without needing
    // a local Playwright setup to inspect what actually ran. Costs a few MB per run in
    // artifact size and a small slowdown; worth it for a suite this small.
    trace: 'on',
  },
  webServer: [
    {
      command: 'npm run start:dev',
      cwd: '../backend',
      url: 'http://localhost:3000/restaurants',
      timeout: 60_000,
      reuseExistingServer: false, // must always be OUR test-configured instance, never a stray leftover process
      env: {
        DB_NAME: 'mannadash_test',
        JWT_SECRET: 'test_jwt_secret',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'test_admin_password',
      },
    },
    { command: 'npm run dev -- --port 5173', cwd: '../frontend', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 30_000 },
    { command: 'npm run dev -- --port 5174', cwd: '../restaurant-dashboard', url: 'http://localhost:5174', reuseExistingServer: true, timeout: 30_000 },
    { command: 'npm run dev -- --port 5175', cwd: '../rider-app', url: 'http://localhost:5175', reuseExistingServer: true, timeout: 30_000 },
  ],
});
