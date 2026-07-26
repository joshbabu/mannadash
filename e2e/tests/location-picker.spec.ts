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

test('address picker: add via the map flow, select, edit, and delete a saved address', async ({ page }) => {
  // The add/edit flow now drives a real Leaflet map with live Nominatim search + reverse
  // geocoding (see AddressPickerScreen/LocationMapScreen). Hitting the live, rate-limited
  // Nominatim API from CI would be slow and flaky, so it's mocked here — deterministic
  // responses in, and this closes the "live geocode search has no automated coverage" gap
  // from earlier, at least for the request/response wiring (not actual map-tile rendering).
  const OFFICE_LAT = 17.5305;
  const OFFICE_LNG = 78.4005;
  const OFFICE_DISPLAY_NAME = 'Test Office Area, Uppal, Hyderabad, Telangana, India';

  await page.route('https://nominatim.openstreetmap.org/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/search') {
      await route.fulfill({
        json: [{ place_id: 1, lat: String(OFFICE_LAT), lon: String(OFFICE_LNG), display_name: OFFICE_DISPLAY_NAME }],
      });
    } else if (url.pathname === '/reverse') {
      await route.fulfill({ json: { display_name: OFFICE_DISPLAY_NAME } });
    } else {
      await route.continue();
    }
  });

  const customerPhone = uniquePhone(3);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E Address CRUD Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  // Each of these overlays the one before it in the DOM rather than replacing it, so every
  // interaction is scoped to its own testid to avoid ambiguous matches against whatever's
  // still mounted (and visually hidden) underneath.
  const addressBar = page.getByTestId('address-bar');
  const picker = page.getByTestId('address-picker');
  const mapScreen = page.getByTestId('location-map-screen');

  await test.step('Adds a new address by searching, dropping the pin, and naming it', async () => {
    await addressBar.click();
    await expect(picker.getByRole('heading', { name: 'Select your location' })).toBeVisible();

    await picker.getByText('Add New Address').click();
    await expect(mapScreen.getByText('Get the fastest delivery')).toBeVisible();

    await mapScreen.getByPlaceholder('Search an area or address').fill('Test Office Area');
    await mapScreen.getByText('Test Office Area', { exact: true }).click();

    // Lands on the pin-placement map step, centered on the search result; the mocked
    // reverse-geocode response should populate the bottom sheet automatically.
    await expect(mapScreen.getByText('Place the pin at exact delivery location')).toBeVisible();
    await expect(mapScreen.getByText(OFFICE_DISPLAY_NAME)).toBeVisible({ timeout: 10_000 });

    await mapScreen.getByRole('button', { name: 'Confirm & proceed' }).click();

    await expect(mapScreen.getByRole('heading', { name: 'Name this address' })).toBeVisible();
    await mapScreen.getByPlaceholder('Label (e.g. Home, Work)').fill('Office');
    await mapScreen.getByRole('button', { name: 'Save address' }).click();

    await expect(mapScreen).not.toBeVisible();
    await expect(picker.getByText('Office', { exact: true })).toBeVisible();
    await expect(picker.getByText(OFFICE_DISPLAY_NAME)).toBeVisible();
  });

  await test.step('Selecting it closes the picker and marks it as the active address', async () => {
    await picker.getByText('Office', { exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect(addressBar.getByText('Office', { exact: true })).toBeVisible(); // now shown on the address bar itself

    await addressBar.click();
    await expect(picker.getByText('SELECTED')).toBeVisible();
  });

  await test.step('Editing opens the map (pre-centered on the existing pin) instead of a text form', async () => {
    await picker.getByLabel('Options for Office').click();
    await picker.getByText('✏️ Edit').click();

    // Edit mode skips the "Get the fastest delivery" prompt and the label step — it goes
    // straight to the pin-placement map, and Confirm & proceed saves immediately.
    await expect(mapScreen.getByText('Get the fastest delivery')).not.toBeVisible();
    await expect(mapScreen.getByText('Place the pin at exact delivery location')).toBeVisible();
    await expect(mapScreen.getByText(OFFICE_DISPLAY_NAME)).toBeVisible({ timeout: 10_000 });

    await mapScreen.getByRole('button', { name: 'Confirm & proceed' }).click();
    await expect(mapScreen).not.toBeVisible();
    await expect(picker.getByText('Office', { exact: true })).toBeVisible();
  });

  await test.step('Deleting removes it from the saved list', async () => {
    await picker.getByLabel('Options for Office').click();
    await picker.getByText('🗑️ Delete').click();
    await expect(picker.getByText('Office', { exact: true })).not.toBeVisible();
    await expect(picker.getByText('No saved addresses yet')).toBeVisible();
  });
});

test('address picker: the top-level search box confirms on the map and saves — not an instant, unsaved selection', async ({ page }) => {
  // This is specifically the bug this test guards against: the top-level "Select your
  // location" search used to apply a tapped result directly as the session's browsing
  // location without ever saving it, so it silently reverted to whatever saved address was
  // already selected on the next load. That looked like "picking from search doesn't work"
  // even though the tap itself registered fine.
  const PLACE_LAT = 17.4059538;
  const PLACE_LNG = 78.5561;
  const PLACE_DISPLAY_NAME = 'Pista House Uppal, Meher Garden Rd, Uppal, Hyderabad, Telangana 500039, India';

  await page.route('https://nominatim.openstreetmap.org/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/search') {
      await route.fulfill({
        json: [{ place_id: 2, lat: String(PLACE_LAT), lon: String(PLACE_LNG), display_name: PLACE_DISPLAY_NAME }],
      });
    } else if (url.pathname === '/reverse') {
      await route.fulfill({ json: { display_name: PLACE_DISPLAY_NAME } });
    } else {
      await route.continue();
    }
  });

  const customerPhone = uniquePhone(5);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E Top-Level Search Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  const picker = page.getByTestId('address-picker');
  const mapScreen = page.getByTestId('location-map-screen');
  const addressBar = page.getByTestId('address-bar');

  await addressBar.click();
  await picker.getByPlaceholder('Search an area or address').fill('Pista House');

  // Tapping the result must NOT close the picker or apply anything instantly — it must
  // land on the pin-confirm map, pre-centered on the result, exactly like "Add New Address".
  await picker.getByText('Pista House Uppal', { exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(mapScreen.getByText('Place the pin at exact delivery location')).toBeVisible();
  await expect(mapScreen.getByText(PLACE_DISPLAY_NAME)).toBeVisible({ timeout: 10_000 });

  await mapScreen.getByRole('button', { name: 'Confirm & proceed' }).click();
  await expect(mapScreen.getByRole('heading', { name: 'Name this address' })).toBeVisible();
  // Pre-filled from the search result's name, matching the reference behavior
  await expect(mapScreen.getByPlaceholder('Label (e.g. Home, Work)')).toHaveValue('Pista House Uppal');
  await mapScreen.getByRole('button', { name: 'Save address' }).click();

  // Saving closes the whole picker (not back to the "Select your location" list) and the
  // newly saved address is immediately active — the actual fix.
  await expect(mapScreen).not.toBeVisible();
  await expect(picker).not.toBeVisible();
  await expect(addressBar.getByText('Pista House Uppal', { exact: true })).toBeVisible();
});

test('a location-permission banner shows when access is off', async ({ page, context }) => {
  // Playwright's default browser context has no geolocation permission granted, which is
  // exactly the "off" state this banner should react to.
  await context.clearPermissions();

  const customerPhone = uniquePhone(4);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E Permission Banner Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  await expect(page.getByText('Location Permission is Off')).toBeVisible();
});

test('no permission banner shows when location access is already granted', async ({ page, context }) => {
  // Granted from the very first page load (rather than granting mid-test and clicking
  // GRANT) sidesteps a real race: the app's own Permissions-API onchange listener can hide
  // the banner the instant context.grantPermissions() takes effect, which could remove the
  // button out from under a scripted click. Testing both states of the initial check is
  // just as strong a guarantee and doesn't depend on that timing.
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 17.5, longitude: 78.5 });

  const customerPhone = uniquePhone(5);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E No Banner Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  await expect(page.getByText('Location Permission is Off')).not.toBeVisible();
});
