import { test, expect, request } from '@playwright/test';

const API_BASE = 'http://localhost:3000';

function uniquePhone(prefix: number) {
  const raw = `${Date.now()}${prefix}`.slice(-9).padStart(9, '0');
  return `9${raw}`;
}

// Same default the customer app falls back to when there's no saved address —
// Hitech City, Hyderabad. Kept in sync deliberately rather than imported, since this
// is asserting on the app's actual fallback behavior, not just mirroring its source.
const DEFAULT_LAT = 17.4435;
const DEFAULT_LNG = 78.3772;

// Placed ~10km from the default center — outside the default 8km nearby-search radius —
// but the customer's saved "Home" address below sits right next to it. Regression coverage
// for the bug where the address bar showed the saved address while distances/results were
// still computed from the hardcoded default location: before the fix, this restaurant simply
// never showed up until a saved address was selected.
const RESTAURANT_LAT = 17.53;
const RESTAURANT_LNG = 78.4;
const HOME_LAT = 17.5305;
const HOME_LNG = 78.4005;

test('restaurant distances reflect the selected saved address, not the default location', async ({ page }) => {
  const api = await request.newContext({ baseURL: API_BASE });

  const restaurantPhone = uniquePhone(1);
  const restaurantName = `E2E Location Test Restaurant ${restaurantPhone}`;

  await test.step('Set up an approved restaurant far from the default location', async () => {
    const created = await api.post('/restaurants', {
      data: {
        ownerName: 'E2E Test Owner',
        name: restaurantName,
        cuisineType: 'Test',
        address: 'Test Address',
        phone: restaurantPhone,
        latitude: RESTAURANT_LAT,
        longitude: RESTAURANT_LNG,
        costForTwo: 500,
      },
    });
    expect(created.ok()).toBeTruthy();
    const restaurantId = (await created.json()).id;

    const adminAuth = await api.post('/admin/login', {
      data: { username: 'admin', password: 'test_admin_password' },
    });
    expect(adminAuth.ok()).toBeTruthy();
    const adminToken = (await adminAuth.json()).accessToken;

    const approveRes = await api.patch(`/restaurants/${restaurantId}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'approved' },
    });
    expect(approveRes.ok()).toBeTruthy();
  });

  let customerToken: string;

  await test.step('Customer signs up', async () => {
    const customerPhone = uniquePhone(2);
    await page.goto('http://localhost:5173');
    await page.getByText('Create an account').click();
    await page.getByPlaceholder('Full name').fill('E2E Location Customer');
    await page.getByPlaceholder('Phone number').fill(customerPhone);
    await page.getByPlaceholder('Password').fill('testpass123');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

    customerToken = (await page.evaluate(() => localStorage.getItem('dabba_token'))) as string;
    expect(customerToken).toBeTruthy();
  });

  await test.step('Before any saved address, the far-away restaurant is not in range', async () => {
    await expect(page.getByText(restaurantName)).not.toBeVisible();
  });

  await test.step('Save a Home address right next to the restaurant, via the API (exact coordinates aren\'t enterable through the Add New Address form, which just captures the current map center)', async () => {
    const addRes = await api.post('/customers/me/addresses', {
      headers: { Authorization: `Bearer ${customerToken}` },
      data: { label: 'Home', address: 'Near the test restaurant', latitude: HOME_LAT, longitude: HOME_LNG },
    });
    expect(addRes.ok()).toBeTruthy();
  });

  await test.step('Selecting Home from the location picker brings the restaurant into range', async () => {
    await page.reload();
    await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

    // The address bar auto-selects the first saved address and reloads restaurants from it
    // on mount — this is exactly the behavior the regression fix added. Scoped to the
    // address bar specifically since "Home" also matches the bottom-nav tab.
    await expect(page.getByTestId('address-bar').getByText('Home')).toBeVisible();
    await expect(page.getByText(restaurantName)).toBeVisible({ timeout: 10_000 });

    // Confirm it's reading as genuinely nearby, not just present in a wider unfiltered list
    const card = page.locator('.rest-card', { hasText: restaurantName });
    await expect(card.getByText(/km$/)).toBeVisible();
    const distanceText = await card.getByText(/km$/).textContent();
    const km = parseFloat(distanceText!.replace('km', '').trim());
    expect(km).toBeLessThan(1);
  });
});

test('address picker: add, edit, select, and delete a saved address', async ({ page }) => {
  const customerPhone = uniquePhone(3);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E Address CRUD Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  // The picker overlays the address bar rather than replacing it in the DOM, so every
  // interaction while it's open is scoped here — otherwise a label like "Office" could
  // ambiguously match both the picker row and the (visually hidden but still-mounted)
  // address bar underneath once it's selected.
  const picker = page.getByTestId('address-picker');

  const addressBar = page.getByTestId('address-bar');

  await test.step('Opens the location picker and adds a new address', async () => {
    await addressBar.click();
    await expect(picker.getByRole('heading', { name: 'Select your location' })).toBeVisible();

    await picker.getByText('Add New Address').click();
    await picker.getByPlaceholder('Label (e.g. Home, Work)').fill('Office');
    await picker.getByPlaceholder('Full address').fill('123 Test Street, Hyderabad');
    await picker.getByRole('button', { name: 'Save address' }).click();

    await expect(picker.getByText('Office')).toBeVisible();
    await expect(picker.getByText('123 Test Street, Hyderabad')).toBeVisible();
  });

  await test.step('Selecting it closes the picker and marks it as the active address', async () => {
    await picker.getByText('Office').click();
    await expect(page.getByTestId('address-picker')).not.toBeVisible();
    await expect(addressBar.getByText('Office')).toBeVisible(); // now shown on the address bar itself

    await addressBar.click();
    await expect(picker.getByText('SELECTED')).toBeVisible();
  });

  await test.step('Editing updates the label and address in place', async () => {
    await picker.getByLabel('Options for Office').click();
    await picker.getByText('✏️ Edit').click();
    await picker.locator('input').last().fill('Work HQ');
    await picker.locator('textarea').last().fill('456 Renamed Street, Hyderabad');
    await picker.getByRole('button', { name: 'Save' }).click();

    await expect(picker.getByText('Work HQ')).toBeVisible();
    await expect(picker.getByText('456 Renamed Street, Hyderabad')).toBeVisible();
    await expect(picker.getByText('Office')).not.toBeVisible();
  });

  await test.step('Deleting removes it from the saved list', async () => {
    await picker.getByLabel('Options for Work HQ').click();
    await picker.getByText('🗑️ Delete').click();
    await expect(picker.getByText('Work HQ')).not.toBeVisible();
    await expect(picker.getByText('No saved addresses yet')).toBeVisible();
  });
});
