import { test, expect, request } from '@playwright/test';

const API_BASE = 'http://localhost:3000';

function uniquePhone(prefix: number) {
  // Must be exactly 10 digits, starting with 6-9 — same fix applied to the backend test helpers
  const raw = `${Date.now()}${prefix}`.slice(-9).padStart(9, '0');
  return `9${raw}`;
}

test('full order flow: customer orders, restaurant accepts, rider delivers', async ({ browser }) => {
  const api = await request.newContext({ baseURL: API_BASE });

  let restaurantId: string, restaurantToken: string, restaurantPhone: string, restaurantName: string;
  let riderId: string, riderToken: string, riderPhone: string;

  await test.step('Set up: a real restaurant, rider, and admin approval', async () => {
    restaurantPhone = uniquePhone(1);
    restaurantName = `E2E Test Restaurant ${restaurantPhone}`;
    const created = await api.post('/restaurants', {
      data: {
        ownerName: 'E2E Test Owner',
        name: restaurantName,
        cuisineType: 'Test',
        address: 'Test Address',
        phone: restaurantPhone,
        latitude: 17.44,
        longitude: 78.38,
        // Phase 4: captured at onboarding, rendered on the customer's restaurant card
        isVegOnly: true,
        costForTwo: 500,
      },
    });
    expect(created.ok()).toBeTruthy();
    restaurantId = (await created.json()).id;

    const restaurantAuth = await api.post('/restaurants/signup', {
      data: { restaurantId, password: 'testpass123' },
    });
    expect(restaurantAuth.ok()).toBeTruthy();
    restaurantToken = (await restaurantAuth.json()).accessToken;

    riderPhone = uniquePhone(2);
    const riderAuth = await api.post('/delivery-partners/signup', {
      data: { name: 'E2E Test Rider', phone: riderPhone, password: 'testpass123', vehicleType: 'bike' },
    });
    expect(riderAuth.ok()).toBeTruthy();
    const riderBody = await riderAuth.json();
    riderToken = riderBody.accessToken;
    riderId = riderBody.rider.id;

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

    const verifyRes = await api.patch(`/delivery-partners/${riderId}/verify`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(verifyRes.ok()).toBeTruthy();

    const menuItemRes = await api.post('/menu-items', {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { restaurantId, name: 'E2E Test Dish', price: 199, category: 'main' },
    });
    expect(menuItemRes.ok()).toBeTruthy();
  });

  // Three simultaneous real browser sessions, exactly like our manual multi-tab testing
  const customerContext = await browser.newContext();
  const restaurantContext = await browser.newContext();
  // Grant location permission up front with fixed coordinates near the test restaurant —
  // otherwise Chrome's real permission prompt appears and just sits there waiting for a click
  // Playwright never makes, silently blocking the rider from ever getting a location on file.
  const riderContext = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 17.44, longitude: 78.38 },
  });

  const customerPage = await customerContext.newPage();
  const restaurantPage = await restaurantContext.newPage();
  const riderPage = await riderContext.newPage();

  await test.step('Restaurant logs in', async () => {
    await restaurantPage.goto('http://localhost:5174');
    await restaurantPage.getByPlaceholder('Phone number').fill(restaurantPhone);
    await restaurantPage.getByPlaceholder('Password').fill('testpass123');
    await restaurantPage.locator('button[type="submit"]').click();
    await expect(restaurantPage.getByText('Orders')).toBeVisible();
    // Phase 3: the online/offline toggle loads with the restaurant's real state
    await expect(restaurantPage.getByRole('button', { name: 'Go offline' })).toBeVisible();
  });

  await test.step('Rider logs in and goes online', async () => {
    await riderPage.goto('http://localhost:5175');
    await riderPage.getByPlaceholder('Phone number').fill(riderPhone);
    await riderPage.getByPlaceholder('Password').fill('testpass123');
    await riderPage.locator('button[type="submit"]').click();
    await riderPage.getByRole('button', { name: 'Go online' }).click();
    await expect(riderPage.getByText("You're online")).toBeVisible();
  });

  await test.step('Customer signs up and places an order', async () => {
    const customerPhone = uniquePhone(3);
    await customerPage.goto('http://localhost:5173');
    await customerPage.getByText('Create an account').click();
    await customerPage.getByPlaceholder('Full name').fill('E2E Test Customer');
    await customerPage.getByPlaceholder('Phone number').fill(customerPhone);
    await customerPage.getByPlaceholder('Password').fill('testpass123');
    await customerPage.locator('button[type="submit"]').click();

    await customerPage.getByPlaceholder('Search by name or cuisine…').fill(restaurantName);
    // Phase 4: the card surfaces what onboarding captured — veg-only badge and cost for two
    await expect(customerPage.getByText('🌱 Pure Veg')).toBeVisible();
    await expect(customerPage.getByText('₹500 for two')).toBeVisible();
    await customerPage.getByText(restaurantName).click();
    await customerPage.getByText('E2E Test Dish').waitFor();
    await customerPage.getByRole('button', { name: 'Add' }).first().click();
    await customerPage.getByText(/View cart/).click();
    await customerPage.getByPlaceholder('Flat / house number, street, landmark').fill('E2E Test Delivery Address');
    await customerPage.getByRole('button', { name: 'Place order' }).click();
    await expect(customerPage.getByText(restaurantName)).toBeVisible();
  });

  await test.step('Restaurant receives the order live and prepares it', async () => {
    // This is the exact bug we fixed earlier — the order must appear with no page refresh
    await expect(restaurantPage.getByText('E2E Test Delivery Address')).toBeVisible({ timeout: 15_000 });
    // Phase 3 status cards: located by testid, since card labels like "Ready" also appear
    // in order-card text ("Ready for pickup — waiting for the rider") and would collide
    const cardFor = (key: string) => restaurantPage.getByTestId(`status-card-${key}`);
    await expect(cardFor('pending')).toContainText('1');
    await restaurantPage.getByRole('button', { name: 'Accept order' }).click();
    // …moves to Preparing once accepted…
    await expect(cardFor('preparing')).toContainText('1');
    await expect(cardFor('pending')).toContainText('0');
    await restaurantPage.getByRole('button', { name: 'Start preparing' }).click();
    await restaurantPage.getByRole('button', { name: 'Mark food ready' }).click();
    // …and lands in Ready once the kitchen is done
    await expect(cardFor('ready')).toContainText('1');

    const assignButton = restaurantPage.getByRole('button', { name: 'Auto-assign nearest' });
    if (await assignButton.isVisible()) {
      await assignButton.click();
    }
  });

  await test.step('Rider receives the assignment live and delivers it', async () => {
    await expect(riderPage.getByText('E2E Test Delivery Address')).toBeVisible({ timeout: 15_000 });
    await riderPage.getByRole('button', { name: 'Mark picked up' }).click();
    await riderPage.getByRole('button', { name: 'Mark delivered' }).click();
  });

  await test.step('Customer sees the delivery confirmed live', async () => {
    await expect(customerPage.getByText('Delivered')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Restaurant sees the delivered order in Order History', async () => {
    await restaurantPage.getByRole('button', { name: 'Order History' }).click();
    // Summary cards render with real numbers — and exactly ONE rupee symbol on Revenue
    // (regression: the card once rendered "₹ ₹2,390" because both the icon and the
    // formatted value carried the symbol)
    await expect(restaurantPage.getByText(/💰\s*₹[\d,]+/)).toBeVisible();
    await expect(restaurantPage.getByText(/₹\s*₹/)).toHaveCount(0);
    // Summary card and the order row itself, with the customer who placed it
    await expect(restaurantPage.getByText('E2E Test Customer')).toBeVisible();
    await expect(restaurantPage.locator('.pill.status-delivered').first()).toBeVisible();
    // Expanding the row shows what was ordered
    await restaurantPage.getByText('E2E Test Customer').click();
    await expect(restaurantPage.getByText(/E2E Test Dish × 1/)).toBeVisible();
  });

  await customerContext.close();
  await restaurantContext.close();
  await riderContext.close();
});

test('customer can cancel their own order before the restaurant accepts it', async ({ browser }) => {
  const api = await request.newContext({ baseURL: API_BASE });

  const restaurantPhone = uniquePhone(4);
  const restaurantName = `E2E Cancel Test Restaurant ${restaurantPhone}`;
  const created = await api.post('/restaurants', {
    data: {
      ownerName: 'Cancel Test Owner',
      name: restaurantName,
      cuisineType: 'Test',
      address: 'Test Address',
      phone: restaurantPhone,
      latitude: 17.44,
      longitude: 78.38,
    },
  });
  expect(created.ok()).toBeTruthy();
  const restaurantId = (await created.json()).id;

  const restaurantAuth = await api.post('/restaurants/signup', { data: { restaurantId, password: 'testpass123' } });
  expect(restaurantAuth.ok()).toBeTruthy();
  const restaurantToken = (await restaurantAuth.json()).accessToken;

  const adminAuth = await api.post('/admin/login', { data: { username: 'admin', password: 'test_admin_password' } });
  expect(adminAuth.ok()).toBeTruthy();
  const adminToken = (await adminAuth.json()).accessToken;

  const approveRes = await api.patch(`/restaurants/${restaurantId}/status`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { status: 'approved' },
  });
  expect(approveRes.ok()).toBeTruthy();

  const menuItemRes = await api.post('/menu-items', {
    headers: { Authorization: `Bearer ${restaurantToken}` },
    data: { restaurantId, name: 'Cancel Test Dish', price: 149, category: 'main' },
  });
  expect(menuItemRes.ok()).toBeTruthy();

  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();

  await test.step('Customer places an order', async () => {
    const customerPhone = uniquePhone(5);
    await customerPage.goto('http://localhost:5173');
    await customerPage.getByText('Create an account').click();
    await customerPage.getByPlaceholder('Full name').fill('Cancel Test Customer');
    await customerPage.getByPlaceholder('Phone number').fill(customerPhone);
    await customerPage.getByPlaceholder('Password').fill('testpass123');
    await customerPage.locator('button[type="submit"]').click();

    await customerPage.getByPlaceholder('Search by name or cuisine…').fill(restaurantName);
    await customerPage.getByText(restaurantName).click();
    await customerPage.getByText('Cancel Test Dish').waitFor();
    await customerPage.getByRole('button', { name: 'Add' }).first().click();
    await customerPage.getByText(/View cart/).click();
    await customerPage.getByPlaceholder('Flat / house number, street, landmark').fill('Cancel Test Address');
    await customerPage.getByRole('button', { name: 'Place order' }).click();
    await expect(customerPage.getByText(restaurantName)).toBeVisible();
  });

  await test.step('Customer cancels it using the real Cancel button', async () => {
    // Auto-accept the confirm() dialog the cancel button triggers
    customerPage.on('dialog', (dialog) => dialog.accept());
    await customerPage.getByRole('button', { name: 'Cancel order' }).click();
    await expect(customerPage.getByText('This order was cancelled')).toBeVisible({ timeout: 10_000 });
  });

  await customerContext.close();
});
