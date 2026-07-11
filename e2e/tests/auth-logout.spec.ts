import { test, expect, request as playwrightRequest } from '@playwright/test';

/**
 * Regression coverage for the logout bug found 2026-07-10: every app's logout() cleared
 * the auth token but left the cached user/rider/restaurant/admin object in localStorage.
 * In-memory state reset masked it within the same tab, but a page refresh right after
 * logging out re-hydrated the dashboard from that stale object with no valid token
 * underneath — every API call then failed with "Unauthorized" while the UI still looked
 * logged in.
 *
 * Each case: log in for real through the browser, log out through the real button, reload,
 * and assert the login form is showing with no "Unauthorized" text anywhere on the page.
 * Accounts are created via the API first (fast, deterministic) — this spec is testing the
 * logout/cache bug specifically, not signup, so there's no need to drive that through the UI.
 */

const uniquePhone = (seed: number) => `9${String(Date.now()).slice(-8)}${seed}`;

test('logout clears the cached session on every app — refreshing after logout lands back on login', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:3000' });

  await test.step('Customer app', async () => {
    const phone = uniquePhone(1);
    await api.post('/auth/signup', { data: { name: 'Logout Test Customer', phone, password: 'testpass123' } });

    const page = await browser.newPage();
    await page.goto('http://localhost:5173');
    await page.getByPlaceholder('Phone number').fill(phone);
    await page.getByPlaceholder('Password').fill('testpass123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await page.reload();
    await expect(page.getByPlaceholder('Phone number')).toBeVisible();
    await expect(page.getByText('Unauthorized')).toHaveCount(0);
    await page.close();
  });

  await test.step('Rider app', async () => {
    const phone = uniquePhone(2);
    await api.post('/delivery-partners/signup', {
      data: { name: 'Logout Test Rider', phone, password: 'testpass123', vehicleType: 'bike' },
    });

    const page = await browser.newPage();
    await page.goto('http://localhost:5175');
    await page.getByPlaceholder('Phone number').fill(phone);
    await page.getByPlaceholder('Password').fill('testpass123');
    // Two "Log in" buttons exist at once here — a login/signup mode toggle, and the submit
    // button — so target the submit button specifically rather than by its shared label
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await page.reload();
    await expect(page.getByPlaceholder('Phone number')).toBeVisible();
    await expect(page.getByText('Unauthorized')).toHaveCount(0);
    await page.close();
  });

  await test.step('Restaurant dashboard', async () => {
    const phone = uniquePhone(3);
    const created = await api.post('/restaurants', {
      data: {
        ownerName: 'Logout Test Owner',
        name: `Logout Test Restaurant ${phone}`,
        cuisineType: 'Test',
        address: 'Test Address',
        phone,
        latitude: 17.44,
        longitude: 78.38,
      },
    });
    const restaurantId = (await created.json()).id;
    // Real flow is two steps: apply (above, public), then claim with a password
    await api.post('/restaurants/signup', { data: { restaurantId, password: 'testpass123' } });

    const page = await browser.newPage();
    await page.goto('http://localhost:5174');
    await page.getByPlaceholder('Phone number').fill(phone);
    await page.getByPlaceholder('Password').fill('testpass123');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Log out' }).click();
    await page.reload();
    await expect(page.getByPlaceholder('Phone number')).toBeVisible();
    await expect(page.getByText('Unauthorized')).toHaveCount(0);
    await page.close();
  });

  await test.step('Admin panel', async () => {
    const page = await browser.newPage();
    await page.goto('http://localhost:5176');
    await page.getByPlaceholder('Username').fill('admin');
    await page.getByPlaceholder('Password').fill('test_admin_password');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await page.reload();
    await expect(page.getByPlaceholder('Username')).toBeVisible();
    await expect(page.getByText('Unauthorized')).toHaveCount(0);
    await page.close();
  });

  await api.dispose();
});
