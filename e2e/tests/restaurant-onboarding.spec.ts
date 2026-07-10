import { test, expect, request } from '@playwright/test';

const API_BASE = 'http://localhost:3000';

function uniquePhone(prefix: number) {
  const raw = `${Date.now()}${prefix}`.slice(-9).padStart(9, '0');
  return `9${raw}`;
}

/**
 * Drives the 3-step restaurant onboarding wizard through a real browser — the same journey a
 * Hyderabad restaurant owner takes: identity + contact, KYC documents, hours + menu basics.
 * Then verifies through the API that what the wizard collected actually landed:
 *  - public restaurant record has the public fields (veg-only, cost for two, per-day hours)
 *  - PAN and bank details are NOT in the public record
 *  - the admin-only KYC endpoint returns exactly what was typed
 */
test('restaurant onboarding wizard: register through all three steps', async ({ page }) => {
  const api = await request.newContext({ baseURL: API_BASE });
  const phone = uniquePhone(7);
  const restaurantName = `E2E Wizard Restaurant ${phone}`;

  await page.goto('http://localhost:5174');
  await page.getByRole('button', { name: 'Register restaurant' }).click();

  await test.step('Step 1: restaurant information and owner contact', async () => {
    await page.getByPlaceholder('Your name').fill('E2E Wizard Owner');
    await page.getByPlaceholder('Restaurant name').fill(restaurantName);
    await page.getByPlaceholder('Cuisine type (e.g. Biryani)').fill('Hyderabadi');
    await page.getByPlaceholder('Address', { exact: true }).fill('Road No 1, Banjara Hills, Hyderabad');
    await page.getByPlaceholder('Phone number').fill(phone);
    await page.getByPlaceholder('Email address').fill('wizard-owner@example.com');
    // Leave "WhatsApp same as phone" checked — the payload should reuse the phone number
    await page.getByPlaceholder('Choose a password').fill('testpass123');
    await page.getByRole('button', { name: 'Next: Documents' }).click();
  });

  await test.step('Step 2: KYC documents and bank details', async () => {
    await page.getByPlaceholder('FSSAI licence number (14 digits)').fill('12345678901234');
    await page.locator('input[type="date"]').fill('2027-03-31');
    await page.getByPlaceholder('Business / owner PAN').fill('aamcr7443m'); // lowercase — UI must uppercase it
    await page.getByPlaceholder('GSTIN').fill('36AAMCR7443M1ZP');
    await page.getByPlaceholder('Bank IFSC code').fill('HDFC0001234');
    await page.getByPlaceholder('Bank account number').fill('123456789012');
    await page.getByRole('button', { name: 'Next: Hours & Menu' }).click();
  });

  await test.step('Step 3: working days, hours, and menu basics', async () => {
    // Close on Sundays — exercises the per-day null path end to end
    await page.getByText('Sun', { exact: true }).click();
    // Keep "same time on all working days" with the 09:00–22:00 defaults
    await page.getByText('Veg only 🌱').click();
    await page.getByPlaceholder('Cost for two (₹, approximate)').fill('400');
    await page.getByRole('button', { name: 'Submit registration' }).click();
  });

  await test.step('Lands in the dashboard, awaiting approval', async () => {
    await expect(page.getByText('Awaiting approval.')).toBeVisible();
  });

  await test.step('Settings screen: wizard data prefilled, edits persist', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    // Prefill proves the round trip — including PAN, which only the owner-guarded KYC
    // endpoint can supply (it's excluded from every public response)
    await expect(page.getByPlaceholder('Email address')).toHaveValue('wizard-owner@example.com');
    await expect(page.getByPlaceholder('Business / owner PAN')).toHaveValue('AAMCR7443M');
    await expect(page.getByPlaceholder('Cost for two (₹, approximate)')).toHaveValue('400');

    await page.getByPlaceholder('Cost for two (₹, approximate)').fill('450');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('✓ Saved')).toBeVisible();
  });

  await test.step('Owner changes their password and logs back in with it', async () => {
    await page.getByPlaceholder('Current password').fill('testpass123');
    await page.getByPlaceholder('New password (min 6 characters)').fill('wizardpass99');
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(page.getByText('✓ Changed')).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByPlaceholder('Phone number').fill(phone);
    await page.getByPlaceholder('Password').fill('wizardpass99');
    await page.locator('button[type="submit"]').click();
    // Back in the dashboard, still pending — the new credential is live
    await expect(page.getByText('Awaiting approval.')).toBeVisible();
  });

  await test.step('Everything the wizard collected reached the backend correctly', async () => {
    const list = await (await api.get('/restaurants')).json();
    const restaurant = list.find((r: any) => r.name === restaurantName);
    expect(restaurant).toBeDefined();

    // Public fields present…
    expect(restaurant.ownerEmail).toBe('wizard-owner@example.com');
    expect(restaurant.whatsappNumber).toBe(phone); // "same as phone" checkbox
    expect(restaurant.isVegOnly).toBe(true);
    expect(restaurant.costForTwo).toBe(450); // edited on the Settings screen after the wizard
    expect(restaurant.weeklyHours.sunday).toBeNull();
    expect(restaurant.weeklyHours.monday).toEqual({ open: '09:00', close: '22:00' });

    // …sensitive fields absent from the public record
    expect(restaurant).not.toHaveProperty('pan');
    expect(restaurant).not.toHaveProperty('bankAccountNumber');
    expect(restaurant).not.toHaveProperty('bankIfsc');

    // Admin sees the full KYC, uppercased where the UI normalizes
    const adminLogin = await api.post('/admin/login', {
      data: { username: 'admin', password: 'test_admin_password' },
    });
    const { accessToken } = await adminLogin.json();
    const kyc = await (
      await api.get(`/restaurants/${restaurant.id}/kyc`, { headers: { Authorization: `Bearer ${accessToken}` } })
    ).json();
    expect(kyc.pan).toBe('AAMCR7443M');
    expect(kyc.fssaiNumber).toBe('12345678901234');
    expect(kyc.fssaiExpiry).toBe('2027-03-31');
    expect(kyc.gstin).toBe('36AAMCR7443M1ZP');
    expect(kyc.bankIfsc).toBe('HDFC0001234');
    expect(kyc.bankAccountNumber).toBe('123456789012');
  });
});
