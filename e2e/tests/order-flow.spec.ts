import { test, expect, request } from '@playwright/test';

const API_BASE = 'http://localhost:3000';

function uniquePhone(prefix: number) {
  // Must be exactly 10 digits, starting with 6-9 — same fix applied to the backend test helpers
  const raw = `${Date.now()}${prefix}`.slice(-9).padStart(9, '0');
  return `9${raw}`;
}

test('full order flow: customer orders, restaurant accepts, rider delivers', async ({ browser }) => {
  const api = await request.newContext({ baseURL: API_BASE });

  // --- Setup via API (fast, reliable) — the test itself focuses on the cross-app flow,
  // not re-proving that every signup form works, which the backend e2e tests already cover ---

  const restaurantPhone = uniquePhone(1);
  const restaurantName = `E2E Test Restaurant ${restaurantPhone}`;
  const created = await api.post('/restaurants', {
    data: {
      ownerName: 'E2E Test Owner',
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

  const restaurantAuth = await api.post('/restaurants/signup', {
    data: { restaurantId, password: 'testpass123' },
  });
  expect(restaurantAuth.ok()).toBeTruthy();
  const restaurantToken = (await restaurantAuth.json()).accessToken;

  const riderPhone = uniquePhone(2);
  const riderAuth = await api.post('/delivery-partners/signup', {
    data: { name: 'E2E Test Rider', phone: riderPhone, password: 'testpass123', vehicleType: 'bike' },
  });
  expect(riderAuth.ok()).toBeTruthy();
  const riderBody = await riderAuth.json();
  const riderToken = riderBody.accessToken;
  const riderId = riderBody.rider.id;

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

  // --- Three simultaneous real browser sessions, exactly like our manual multi-tab testing ---

  const customerContext = await browser.newContext();
  const restaurantContext = await browser.newContext();
  const riderContext = await browser.newContext();

  const customerPage = await customerContext.newPage();
  const restaurantPage = await restaurantContext.newPage();
  const riderPage = await riderContext.newPage();

  // Restaurant dashboard: log in (form's submit button, not the "Log in" tab button)
  await restaurantPage.goto('http://localhost:5174');
  await restaurantPage.getByPlaceholder('Phone number').fill(restaurantPhone);
  await restaurantPage.getByPlaceholder('Password').fill('testpass123');
  await restaurantPage.locator('button[type="submit"]').click();
  await expect(restaurantPage.getByText('Orders')).toBeVisible();

  // Rider app: log in and go online
  await riderPage.goto('http://localhost:5175');
  await riderPage.getByPlaceholder('Phone number').fill(riderPhone);
  await riderPage.getByPlaceholder('Password').fill('testpass123');
  await riderPage.locator('button[type="submit"]').click();
  await riderPage.getByRole('button', { name: 'Go online' }).click();
  await expect(riderPage.getByText("You're online")).toBeVisible();

  // Customer app: sign up, find the test restaurant, order
  const customerPhone = uniquePhone(3);
  await customerPage.goto('http://localhost:5173');
  await customerPage.getByText('Create an account').click();
  await customerPage.getByPlaceholder('Full name').fill('E2E Test Customer');
  await customerPage.getByPlaceholder('Phone number').fill(customerPhone);
  await customerPage.getByPlaceholder('Password').fill('testpass123');
  await customerPage.locator('button[type="submit"]').click();

  await customerPage.getByPlaceholder('Search by name or cuisine…').fill(restaurantName);
  await customerPage.getByText(restaurantName).click();
  await customerPage.getByText('E2E Test Dish').waitFor();
  await customerPage.getByRole('button', { name: 'Add' }).first().click();
  await customerPage.getByText(/View cart/).click();
  await customerPage.getByPlaceholder('Flat / house number, street, landmark').fill('E2E Test Delivery Address');
  await customerPage.getByRole('button', { name: 'Place order' }).click();
  await expect(customerPage.getByText(restaurantName)).toBeVisible();

  // Restaurant: the new order should appear live (this is the exact bug we fixed earlier —
  // no refresh should be needed). Full lifecycle: accept -> start preparing -> mark ready.
  await expect(restaurantPage.getByText('E2E Test Delivery Address')).toBeVisible({ timeout: 15_000 });
  await restaurantPage.getByRole('button', { name: 'Accept order' }).click();
  await restaurantPage.getByRole('button', { name: 'Start preparing' }).click();
  await restaurantPage.getByRole('button', { name: 'Mark food ready' }).click();

  const assignButton = restaurantPage.getByRole('button', { name: 'Auto-assign nearest' });
  if (await assignButton.isVisible()) {
    await assignButton.click();
  }

  // Rider: the assignment should appear live too
  await expect(riderPage.getByText('E2E Test Delivery Address')).toBeVisible({ timeout: 15_000 });
  await riderPage.getByRole('button', { name: 'Mark picked up' }).click();
  await riderPage.getByRole('button', { name: 'Mark delivered' }).click();

  // Customer: should see the delivered status live, without refreshing
  await expect(customerPage.getByText('Delivered')).toBeVisible({ timeout: 15_000 });

  await customerContext.close();
  await restaurantContext.close();
  await riderContext.close();
});
