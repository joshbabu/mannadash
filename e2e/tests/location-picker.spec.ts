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

// Placed ~20.8km from the default center — outside the 15km nearby-search radius (widened
// from 8km this session for city-wide coverage, which is exactly why this needed updating:
// the original ~10km offset used to clear the old 8km radius but now falls inside 15km) —
// but the customer's saved "Home" address below sits right next to it. Regression coverage
// for the bug where the address bar showed the saved address while distances/results were
// still computed from the hardcoded default location: before the fix, this restaurant simply
// never showed up until a saved address was selected.
const RESTAURANT_LAT = 17.62515;
const RESTAURANT_LNG = 78.42508;
const HOME_LAT = 17.62565;
const HOME_LNG = 78.42558;

test('restaurant distances reflect the selected saved address, not the default location', async ({ page }) => {
  const api = await request.newContext({ baseURL: API_BASE });

  const restaurantPhone = uniquePhone(1);
  const restaurantName = `E2E Location Test Restaurant ${restaurantPhone}`;

  let restaurantId: string;

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
    restaurantId = (await created.json()).id;

    const claimed = await api.post('/restaurants/signup', { data: { restaurantId, password: 'testpass123' } });
    expect(claimed.ok()).toBeTruthy();
    const restaurantToken = (await claimed.json()).accessToken;

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

    const itemRes = await api.post('/menu-items', {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { restaurantId, name: 'E2E Checkout Address Dish', price: 150, category: 'main' },
    });
    expect(itemRes.ok()).toBeTruthy();
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

  await test.step("Ordering from that restaurant WITHOUT re-picking an address at checkout still uses the real selected address, not the hardcoded default — the actual bug this covers: checkout used to always start fresh at the default location regardless of what was already selected", async () => {
    await page.getByText(restaurantName).click();
    await page.locator('.card', { hasText: 'E2E Checkout Address Dish' }).getByRole('button', { name: 'Add' }).click();
    await page.getByRole('button', { name: /View cart/ }).click();

    // The address must already be filled in from what was selected while browsing — not
    // blank, and not requiring the customer to tap anything address-related first.
    await expect(page.locator('#checkout-cart-summary')).toBeVisible();
    await expect(page.getByText('Near the test restaurant')).toBeVisible();

    // The real proof: delivery fee must reflect the true short distance (the flat ₹25
    // base-tier fee, since Home is right next to the restaurant), not the fee that a
    // ~10km-away hardcoded default would produce.
    await expect(page.locator('#checkout-cart-summary').getByText('₹25', { exact: false })).toBeVisible();
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

    // Lands on the pin-placement map, centered on the search result, with the full
    // "Delivery details" bottom sheet (address details, save-as tags, label) all on the
    // same screen — the mocked reverse-geocode response should populate it automatically.
    await expect(mapScreen.getByText('Delivery details')).toBeVisible();
    await expect(mapScreen.getByText(OFFICE_DISPLAY_NAME)).toBeVisible({ timeout: 10_000 });

    await mapScreen.getByPlaceholder(/Address details/).fill('3rd Floor, Suite 12');
    await mapScreen.getByPlaceholder("Receiver's name").fill('Reception Desk');
    await mapScreen.getByPlaceholder("Receiver's phone (10 digits)").fill('9876543210');
    await mapScreen.getByPlaceholder("Or name it yourself (e.g. Mom's House)").fill('Office');
    await mapScreen.getByRole('button', { name: 'Save address' }).click();

    await expect(mapScreen).not.toBeVisible();
    await expect(picker.getByText('Office', { exact: true })).toBeVisible();
    await expect(picker.getByText(OFFICE_DISPLAY_NAME)).toBeVisible();
    await expect(picker.getByText('3rd Floor, Suite 12', { exact: false })).toBeVisible();
    await expect(picker.getByText('Reception Desk', { exact: false })).toBeVisible();
    await expect(picker.getByText('9876543210', { exact: false })).toBeVisible();
  });

  await test.step('Selecting it closes the picker and marks it as the active address', async () => {
    await picker.getByText('Office', { exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect(addressBar.getByText('Office', { exact: true })).toBeVisible(); // now shown on the address bar itself

    await addressBar.click();
    await expect(picker.getByText('SELECTED')).toBeVisible();
  });

  await test.step('Editing opens the map (pre-centered on the existing pin) with the full form pre-filled — not just a pin-only confirm', async () => {
    await picker.getByLabel('Options for Office').click();
    await picker.getByText('✏️ Edit').click();

    // Edit mode skips the "Get the fastest delivery" prompt — it goes straight to the map,
    // pre-centered on the address's existing coordinates — but shows the SAME full
    // "Delivery details" form as adding, pre-filled with what was already saved, not a
    // stripped-down pin-only confirm. This is what was actually broken before: editing
    // only let you nudge the pin and lost every other field in the process.
    await expect(mapScreen.getByText('Get the fastest delivery')).not.toBeVisible();
    await expect(mapScreen.getByText('Delivery details')).toBeVisible();
    await expect(mapScreen.getByText(OFFICE_DISPLAY_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(mapScreen.getByPlaceholder(/Address details/)).toHaveValue('3rd Floor, Suite 12');
    await expect(mapScreen.getByPlaceholder("Receiver's name")).toHaveValue('Reception Desk');
    await expect(mapScreen.getByPlaceholder("Receiver's phone (10 digits)")).toHaveValue('9876543210');
    await expect(mapScreen.getByPlaceholder("Or name it yourself (e.g. Mom's House)")).toHaveValue('Office');

    // Actually change something to prove the edit round-trips for real, not just the pin
    await mapScreen.getByPlaceholder(/Address details/).fill('4th Floor, Suite 20');
    await mapScreen.getByRole('button', { name: 'Save address' }).click();
    await expect(mapScreen).not.toBeVisible();
    await expect(picker.getByText('Office', { exact: true })).toBeVisible();
    await expect(picker.getByText('4th Floor, Suite 20', { exact: false })).toBeVisible();
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
  await expect(mapScreen.getByText('Delivery details')).toBeVisible();
  await expect(mapScreen.getByText(PLACE_DISPLAY_NAME)).toBeVisible({ timeout: 10_000 });

  // Pre-filled from the search result's name, matching the reference behavior
  await expect(mapScreen.getByPlaceholder("Or name it yourself (e.g. Mom's House)")).toHaveValue('Pista House Uppal');
  await mapScreen.getByRole('button', { name: 'Save address' }).click();

  // Saving closes the whole picker (not back to the "Select your location" list) and the
  // newly saved address is immediately active — the actual fix.
  await expect(mapScreen).not.toBeVisible();
  await expect(picker).not.toBeVisible();
  await expect(addressBar.getByText('Pista House Uppal', { exact: true })).toBeVisible();
});

test('a failed geocode search shows a real error message, not silence — this is the fix for the reported "nothing happens" bug', async ({ page }) => {
  // Reproduces the actual bug: the search code used to call res.json() without checking
  // res.ok first, so a rate-limited or otherwise-failed Nominatim response (very plausible
  // against the real API — it's ~1 req/sec limited) either silently showed "No matches"
  // (misleading) or, if the error body happened to be JSON-shaped, could crash the
  // results render entirely — which from the outside looks exactly like "I typed and
  // nothing happened at all."
  await page.route('https://nominatim.openstreetmap.org/search**', async (route) => {
    await route.fulfill({ status: 429, body: 'Rate limited' });
  });

  const customerPhone = uniquePhone(6);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E Search Failure Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  const addressBar = page.getByTestId('address-bar');
  const picker = page.getByTestId('address-picker');
  const mapScreen = page.getByTestId('location-map-screen');

  await addressBar.click();
  await picker.getByText('Add New Address').click();
  await expect(mapScreen.getByText('Get the fastest delivery')).toBeVisible();

  await mapScreen.getByPlaceholder('Search an area or address').fill('Anywhere');
  await expect(mapScreen.getByText('Could not search right now — try again in a moment.')).toBeVisible();
  // Must NOT show the misleading "no matches" message for what is actually a failure
  await expect(mapScreen.getByText(/No matches for/)).not.toBeVisible();
});

test('address picker: typing a full address geocodes it and lands on that exact spot', async ({ page }) => {
  const TYPED_TEXT = '2-129, Sairam Colony, Vijayapuri Colony, Uppal, Hyderabad';
  const FOUND_LAT = 17.3981827;
  const FOUND_LNG = 78.5669366;
  const FOUND_DISPLAY_NAME = "Pulipati's Nilayam, Sairam Colony, Vijayapuri Colony, Uppal, Hyderabad, Telangana, India";

  await page.route('https://nominatim.openstreetmap.org/search**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === TYPED_TEXT) {
      await route.fulfill({ json: [{ place_id: 9, lat: String(FOUND_LAT), lon: String(FOUND_LNG), display_name: FOUND_DISPLAY_NAME }] });
    } else {
      await route.fulfill({ json: [] });
    }
  });
  await page.route('https://nominatim.openstreetmap.org/reverse**', async (route) => {
    await route.fulfill({ json: { display_name: FOUND_DISPLAY_NAME } });
  });

  const customerPhone = uniquePhone(8);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E Typed Address Found Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  const addressBar = page.getByTestId('address-bar');
  const picker = page.getByTestId('address-picker');
  const mapScreen = page.getByTestId('location-map-screen');

  await addressBar.click();
  await picker.getByText('Add New Address').click();
  await mapScreen.getByText('Or just type your full address').click();
  await mapScreen.getByPlaceholder(/Type your full address/).fill(TYPED_TEXT);
  await mapScreen.getByRole('button', { name: 'Continue' }).click();

  await expect(mapScreen.getByText('Delivery details')).toBeVisible();
  await expect(mapScreen.getByText(FOUND_DISPLAY_NAME)).toBeVisible({ timeout: 10_000 });
  // Found a real match — no "couldn't automatically place" note should show
  await expect(mapScreen.getByText(/Couldn't automatically place/)).not.toBeVisible();
});

test("address picker: typing an address the geocoder can't find still keeps exactly what was typed, with an honest note", async ({ page }) => {
  const TYPED_TEXT = 'Some Very Obscure Personal Building Name Nobody Mapped';

  await page.route('https://nominatim.openstreetmap.org/search**', async (route) => {
    await route.fulfill({ json: [] }); // genuinely no match — real, honest failure
  });

  const customerPhone = uniquePhone(9);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E Typed Address Not Found Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  const addressBar = page.getByTestId('address-bar');
  const picker = page.getByTestId('address-picker');
  const mapScreen = page.getByTestId('location-map-screen');

  await addressBar.click();
  await picker.getByText('Add New Address').click();
  await mapScreen.getByText('Or just type your full address').click();
  await mapScreen.getByPlaceholder(/Type your full address/).fill(TYPED_TEXT);
  await mapScreen.getByRole('button', { name: 'Continue' }).click();

  // Still reaches the map with the full save flow — never a dead end — and what was typed
  // is preserved as the address rather than silently replaced by a reverse-geocode of
  // wherever the fallback center happens to be.
  await expect(mapScreen.getByText('Delivery details')).toBeVisible();
  await expect(mapScreen.getByText(TYPED_TEXT).first()).toBeVisible();
  await expect(mapScreen.getByText(/Couldn't automatically place/)).toBeVisible();

  await mapScreen.getByRole('button', { name: 'Home', exact: false }).click();
  await mapScreen.getByRole('button', { name: 'Save address' }).click();
  await expect(mapScreen).not.toBeVisible();
  await expect(picker.getByText(TYPED_TEXT, { exact: false })).toBeVisible();
});

test('address picker: "Place the pin manually" reaches the full save flow with no dependency on search or geolocation', async ({ page }) => {
  // The actual gap this closes: before this button existed, reaching the pin-drop map at
  // all required either a successful search match or device geolocation — if a personal
  // address genuinely wasn't in Nominatim's database (a real, common case) and the person
  // wasn't using GPS, there was no way to add an address at all.
  const MANUAL_DISPLAY_NAME = 'Manually Placed Pin Address, Hyderabad, Telangana, India';
  await page.route('https://nominatim.openstreetmap.org/reverse**', async (route) => {
    await route.fulfill({ json: { display_name: MANUAL_DISPLAY_NAME } });
  });

  const customerPhone = uniquePhone(7);
  await page.goto('http://localhost:5173');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Full name').fill('E2E Manual Pin Customer');
  await page.getByPlaceholder('Phone number').fill(customerPhone);
  await page.getByPlaceholder('Password').fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder('Search by name, cuisine, or dish…')).toBeVisible();

  const addressBar = page.getByTestId('address-bar');
  const picker = page.getByTestId('address-picker');
  const mapScreen = page.getByTestId('location-map-screen');

  await addressBar.click();
  await picker.getByText('Add New Address').click();
  await expect(mapScreen.getByText('Get the fastest delivery')).toBeVisible();

  await mapScreen.getByText('Place the pin manually on a map').click();
  await expect(mapScreen.getByText('Delivery details')).toBeVisible();
  await expect(mapScreen.getByText(MANUAL_DISPLAY_NAME)).toBeVisible({ timeout: 10_000 });

  await mapScreen.getByPlaceholder(/Address details/).fill('Flat 4B');
  const homeTag = mapScreen.getByRole('button', { name: '🏠 Home' });
  await homeTag.click();
  await expect(mapScreen.getByPlaceholder("Or name it yourself (e.g. Mom's House)")).toHaveValue('Home');

  await mapScreen.getByRole('button', { name: 'Save address' }).click();
  await expect(mapScreen).not.toBeVisible();
  await expect(picker.getByText('Home', { exact: true })).toBeVisible();
  await expect(picker.getByText('Flat 4B', { exact: false })).toBeVisible();
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
