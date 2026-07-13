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
  let customerPhone: string;
  let menuItemId: string;

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
        fssaiNumber: '12345678901234', // shown in the menu-page info footer
        fssaiExpiry: '2027-03-31',
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
      data: { restaurantId, name: 'E2E Test Dish', price: 199, category: 'main', isVeg: true },
    });
    expect(menuItemRes.ok()).toBeTruthy();
    menuItemId = (await menuItemRes.json()).id;
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
    customerPhone = uniquePhone(3);
    await customerPage.goto('http://localhost:5173');
    // PWA installability — required for push notifications to work on iOS Safari at all.
    // Cheap to check, easy to silently break if index.html gets touched later.
    await expect(customerPage.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json');
    const manifestRes = await customerPage.request.get('http://localhost:5173/manifest.json');
    expect(manifestRes.ok()).toBeTruthy();
    const manifest = await manifestRes.json();
    expect(manifest.icons.length).toBeGreaterThan(0);
    await customerPage.getByText('Create an account').click();

    // Terms & Privacy Policy — reachable from signup, and clicking through doesn't lose
    // the form the customer was filling in
    await customerPage.getByRole('button', { name: 'Terms of Service' }).click();
    await expect(customerPage.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
    await customerPage.getByRole('button', { name: 'Privacy Policy' }).click();
    await expect(customerPage.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await customerPage.getByRole('button', { name: '← Back' }).click();
    await expect(customerPage.getByPlaceholder('Full name')).toBeVisible();

    await customerPage.getByPlaceholder('Full name').fill('E2E Test Customer');
    await customerPage.getByPlaceholder('Phone number').fill(customerPhone);
    await customerPage.getByPlaceholder('Password').fill('testpass123');
    await customerPage.locator('button[type="submit"]').click();

    await customerPage.getByPlaceholder('Search by name, cuisine, or dish…').fill(restaurantName);
    // Phase 4: the card surfaces what onboarding captured — veg-only badge and cost for two
    await expect(customerPage.getByText('🌱 Pure Veg')).toBeVisible();
    await expect(customerPage.getByText('₹500 for two')).toBeVisible();
    await customerPage.getByText(restaurantName).click();
    await customerPage.getByText('E2E Test Dish').waitFor();

    // Spice pack: the Indian-convention veg indicator on the dish itself
    await expect(customerPage.locator('[title="Veg"]').first()).toBeVisible();

    // In-menu search: filters live, explains an empty result, and comes back on clear
    const menuSearch = customerPage.getByPlaceholder(/^Search in /);
    await menuSearch.fill('zzzzz');
    await expect(customerPage.getByText(/Nothing on the menu matches/)).toBeVisible();
    await menuSearch.fill('e2e test');
    await expect(customerPage.getByText('E2E Test Dish')).toBeVisible();
    await menuSearch.fill('');

    // Info footer: address, hours, and the FSSAI licence (collected at onboarding)
    await expect(customerPage.getByText('FSSAI Lic. No. 12345678901234')).toBeVisible();

    await customerPage.getByRole('button', { name: 'Add' }).first().click();
    await customerPage.getByText(/View cart/).click();
    await customerPage.getByPlaceholder('Flat / house number, street, landmark').fill('E2E Test Delivery Address');
    // Cooking instructions travel with the order to the kitchen — now behind a tab
    // (Delivery Type / Tip / Instructions), not always visible like it used to be
    await customerPage.getByRole('button', { name: 'Instructions', exact: true }).click();
    // A quick-tap chip combines with free text into one plain string — no separate
    // backend field, just a faster way to fill the same instructions box
    await customerPage.getByRole('button', { name: '🚪 Leave at the door' }).click();
    await customerPage.getByPlaceholder('e.g. less spicy, no onions…').fill('Less spicy please');
    // COD is the default payment method (Razorpay is gated on real keys)
    await expect(customerPage.getByText('💵 Cash on delivery')).toBeVisible();
    await customerPage.getByRole('button', { name: 'Place order' }).click();
    await expect(customerPage.getByText(restaurantName)).toBeVisible();
  });

  await test.step('Restaurant receives the order live and prepares it', async () => {
    // This is the exact bug we fixed earlier — the order must appear with no page refresh
    await expect(restaurantPage.getByText('E2E Test Delivery Address')).toBeVisible({ timeout: 15_000 });
    await expect(restaurantPage.getByText('📝 Leave at the door, Less spicy please')).toBeVisible();
    // Phase C: the accept-countdown is visible on a still-placed order, warning the
    // restaurant it will auto-cancel if left untouched
    await expect(restaurantPage.getByText(/⏱ Accept within \d:\d\d — auto-cancels if not accepted/)).toBeVisible();
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
    // COD order: the rider is told exactly how much cash to collect at the door
    await expect(riderPage.getByText(/💵 Collect ₹\d+ in cash/)).toBeVisible();
    await riderPage.getByRole('button', { name: 'Mark picked up' }).click();
    await riderPage.getByRole('button', { name: 'Mark delivered' }).click();
  });

  await test.step('Customer sees the delivery confirmed live, with a full receipt', async () => {
    // Scoped to the status ladder specifically — once the receipt (below) renders, the
    // word "Delivered" legitimately appears a second time in its delivery timeline, which
    // would otherwise make this locator ambiguous
    await expect(customerPage.locator('.tiffin-tier.current', { hasText: 'Delivered' })).toBeVisible({ timeout: 15_000 });
    // The receipt: itemized lines, fee breakdown, delivery timeline, and who delivered it
    await expect(customerPage.getByText('Receipt')).toBeVisible();
    await expect(customerPage.getByText('E2E Test Dish × 1')).toBeVisible();
    await expect(customerPage.getByText('Delivery fee')).toBeVisible();
    await expect(customerPage.getByText(/by E2E Test Rider/)).toBeVisible();
    await expect(customerPage.getByText(/Picked up from .*Test Address/)).toBeVisible();
    await expect(customerPage.getByText('💵 Cash on delivery')).toBeVisible();
    // Regression: receipt labels use .muted, which is light-on-dark globally — inside the
    // cream receipt card they must resolve to the dark muted tone or they're invisible
    await expect(customerPage.getByText('Item total')).toHaveCSS('color', 'rgb(107, 97, 86)');
    await expect(customerPage.getByRole('button', { name: /Print \/ save as PDF/ })).toBeVisible();
  });

  await test.step('A rating survives a page reload — the app never re-asks', async () => {
    // The rating form is showing (order just delivered, not yet rated)
    await expect(customerPage.getByText('How was your order?')).toBeVisible();
    // Rate via the API as this customer (star-clicking is covered by backend tests;
    // what the browser must prove is the reload persistence, which was the bug)
    const login = await api.post('/auth/login', { data: { phone: customerPhone, password: 'testpass123' } });
    const { accessToken } = await login.json();
    const myOrders = await (await api.get('/orders', { headers: { Authorization: `Bearer ${accessToken}` } })).json();
    const rate = await api.post(`/orders/${myOrders[0].id}/rating`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { restaurantRating: 5, deliveryRating: 5, comment: 'Best biryani in Uppal!' },
    });
    expect(rate.ok()).toBeTruthy();

    // A reload drops the SPA back on Browse — navigate to the order the way a real
    // customer would: Orders tab, tap the order row
    await customerPage.reload();
    await customerPage.getByRole('button', { name: '📋 Orders' }).click();
    await customerPage.getByRole('button', { name: new RegExp(restaurantName) }).click();
    await expect(customerPage.getByText('Thanks for rating your order!')).toBeVisible();
    await expect(customerPage.getByText('How was your order?')).toHaveCount(0);
  });

  await test.step('Phase L3: restaurant replies to a review, customer sees the reply', async () => {
    await restaurantPage.getByRole('button', { name: 'Reviews' }).click();
    await expect(restaurantPage.getByText('Best biryani in Uppal!')).toBeVisible();
    const reviewCard = restaurantPage.locator('.card', { hasText: 'Best biryani in Uppal!' });
    await reviewCard.getByRole('button', { name: 'Reply' }).click();
    await reviewCard.getByPlaceholder(/Thank the customer/).fill('Thank you! Come back soon 🙏');
    await reviewCard.getByRole('button', { name: 'Save reply' }).click();
    await expect(reviewCard.getByText('Thank you! Come back soon')).toBeVisible();

    // Customer revisits the menu — the same Back-then-Browse navigation as the Phase J
    // step, since the customer is still deep inside the app from the reload above
    await customerPage.getByRole('button', { name: '← Back' }).click();
    await customerPage.getByRole('button', { name: '🍲 Browse' }).click();
    await customerPage.getByPlaceholder('Search by name, cuisine, or dish…').fill(restaurantName);
    await customerPage.getByText(restaurantName).click();
    await expect(customerPage.getByText('Reply from the restaurant')).toBeVisible();
    await expect(customerPage.getByText('Thank you! Come back soon')).toBeVisible();
  });

  await test.step('Phase H: dish-level search finds this restaurant by a dish it serves', async () => {
    // Same navigation lesson as Phase J/L1/L3 — the customer is on the menu page from
    // the step above, and the Browse tab is hidden while a restaurant is selected.
    await customerPage.getByRole('button', { name: '← Back' }).click();
    await customerPage.getByRole('button', { name: '🍲 Browse' }).click();

    // Category photos fetch — real photo URLs need network access this test env doesn't
    // have, but what's actually worth proving is that the fetch/render doesn't break the
    // screen either way (falls back to the emoji icon cleanly, no crash, category still
    // tappable and searchable)
    await expect(customerPage.getByRole('button', { name: '🍛 Biryani' })).toBeVisible();

    // Tappable category chips (Biryani, Pizza, etc.) just fill the same search box — this
    // proves the UI mechanism itself (tap fills it, tap again clears it), not the search
    // logic, which is already covered by the backend suite and the manual-typing check below
    await customerPage.getByRole('button', { name: '🍛 Biryani' }).click();
    await expect(customerPage.getByPlaceholder('Search by name, cuisine, or dish…')).toHaveValue('Biryani');
    await customerPage.getByRole('button', { name: '🍛 Biryani' }).click(); // toggles back off
    await expect(customerPage.getByPlaceholder('Search by name, cuisine, or dish…')).toHaveValue('');

    // Searching the exact dish name, NOT the restaurant's own name — this restaurant is
    // "E2E Test Restaurant {phone}", nothing about "E2E Test Dish" appears in that name,
    // so a match here can only come from the backend's dish search, not the existing
    // client-side name/cuisine filter
    await customerPage.getByPlaceholder('Search by name, cuisine, or dish…').fill('E2E Test Dish');
    await expect(customerPage.getByText(restaurantName)).toBeVisible({ timeout: 10_000 });
    // The card explains WHY it matched — the dish name, not the restaurant's own info
    await expect(customerPage.getByText('🍽️ E2E Test Dish')).toBeVisible();
    await customerPage.getByText(restaurantName).click();
    await customerPage.getByText('E2E Test Dish').first().waitFor();

    // Regression: a real bug found in production — tapping "Cakes" (plural button label)
    // searched the literal substring "Cakes", which never matches a dish named
    // "Butterscotch Cake" (singular). Fixed by having the button search the singular
    // "Cake" instead while still DISPLAYING "Cakes" — the singular is a substring of both
    // "Cake" and "Cakes", so it matches either, while the plural only matched the plural.
    const cakeItemRes = await api.post('/menu-items', {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { restaurantId, name: 'Butterscotch Cake', price: 250, category: 'dessert' },
    });
    expect(cakeItemRes.ok()).toBeTruthy();
    await customerPage.getByRole('button', { name: '← Back' }).click();
    await customerPage.getByRole('button', { name: '🍲 Browse' }).click();
    await customerPage.getByRole('button', { name: '🍰 Cakes' }).click();
    await expect(customerPage.getByPlaceholder('Search by name, cuisine, or dish…')).toHaveValue('Cake');
    await expect(customerPage.getByText(restaurantName)).toBeVisible({ timeout: 10_000 });
    await expect(customerPage.getByText('🍽️ Butterscotch Cake')).toBeVisible();
  });

  await test.step('Phase L1: offers teaser, automatic discount, and a code overriding it', async () => {
    // A modest automatic offer and a bigger code-based one — the code should win even
    // though it's worth more, proving precedence in a real browser, not just the API
    const autoOfferRes = await api.post('/offers', {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { name: 'Auto 10%', discountType: 'percentage', discountValue: 10 },
    });
    expect(autoOfferRes.ok()).toBeTruthy();
    const codeOfferRes = await api.post('/offers', {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { name: 'Big Save', code: 'BIGSAVE', discountType: 'flat', discountValue: 40 },
    });
    expect(codeOfferRes.ok()).toBeTruthy();

    // Reload resets all in-memory React state (selectedRestaurant included), dropping the
    // customer back on Browse — same lesson as the rating-persistence step above. Navigate
    // back to the restaurant explicitly rather than assuming reload preserves the screen.
    await customerPage.reload();
    await customerPage.getByPlaceholder('Search by name, cuisine, or dish…').fill(restaurantName);
    await customerPage.getByText(restaurantName).click();
    await expect(customerPage.getByText(/🎉 10% OFF/)).toBeVisible();
    await expect(customerPage.getByText(/🎉 ₹40 OFF with code/)).toBeVisible();

    // Scoped to E2E Test Dish specifically — this restaurant also has E2E Variant Dish
    // from the Phase J step, whose "Add" opens a picker instead of adding directly
    await customerPage.locator('.card', { hasText: 'E2E Test Dish' }).getByRole('button', { name: 'Add' }).click();
    await customerPage.getByRole('button', { name: /View cart/ }).click();

    // The 10% auto-offer applies itself with no action from the customer
    await expect(customerPage.getByText('🎉 Auto 10%')).toBeVisible();

    // Typing the code overrides it, even though BIGSAVE's ₹40 isn't necessarily bigger
    // than 10% of this particular cart — the point is the code always wins on principle
    await customerPage.getByPlaceholder('Have a promo code?').fill('bigsave');
    await customerPage.getByRole('button', { name: 'Apply' }).click();
    await expect(customerPage.getByText('🎉 Big Save')).toBeVisible();
    await expect(customerPage.getByText('-₹40')).toBeVisible();
    await expect(customerPage.getByText('🎉 Auto 10%')).toHaveCount(0);
    // Regression: checkout used to say "+ delivery fee, calculated at checkout" instead
    // of a real number — the customer could never see the actual total before ordering
    await expect(customerPage.getByText('calculated at checkout')).toHaveCount(0);
    // GST & platform fee are built but dormant until MannaDash is actually GST-registered
    // — this proves "not configured" genuinely means invisible, not a hidden nonzero charge
    await expect(customerPage.getByText('Taxes & charges')).toHaveCount(0);
    await expect(customerPage.getByText('Platform fee')).toHaveCount(0);
    await expect(customerPage.locator('#checkout-cart-summary').getByText('Delivery fee')).toBeVisible();
    await expect(customerPage.locator('#checkout-cart-summary').getByText('Total', { exact: true })).toBeVisible();

    // The combined savings banner at the top of the page
    await expect(customerPage.getByText('🎉 ₹40 saved on this order!')).toBeVisible();

    // "You are ordering for" banner — the account's own name and phone, no editing yet
    await expect(customerPage.getByText(/You are ordering for/)).toBeVisible();
    await expect(customerPage.getByText(/We'll share order tracking and delivery updates on/)).toBeVisible();

    // The sticky pay bar always shows the real total, and matches the itemized card
    await expect(customerPage.getByText(/To Pay ₹\d+/)).toBeVisible();

    // In-checkout quantity editing — a brand new capability, not just a display change.
    // E2E Test Dish is ₹199; bumping it to 2 should update both the line total and the
    // sticky footer's total without any navigation back to the menu.
    const dishLine = customerPage.locator('#checkout-cart-summary .row', { hasText: 'E2E Test Dish' });
    await dishLine.getByRole('button', { name: '+' }).click();
    await expect(dishLine.getByText('₹398')).toBeVisible(); // 199 × 2
    await dishLine.getByRole('button', { name: '−' }).click(); // back to 1, keeps totals correct downstream

    // Delivery type + tip — capture the total before and after, and check the DELTA
    // rather than an exact figure, since the real distance-based delivery fee for this
    // restaurant/address pair isn't a number this test hardcodes anywhere else.
    const totalBefore = await customerPage.getByText(/To Pay ₹\d+/).textContent();
    const parseTotal = (s: string | null) => Number(s?.match(/\d+/)?.[0] ?? 0);

    await customerPage.getByText('Express', { exact: true }).click();
    await customerPage.getByRole('button', { name: 'Tip', exact: true }).click();
    await customerPage.getByRole('button', { name: '₹20', exact: true }).click();
    await expect(customerPage.locator('#checkout-cart-summary').getByText('+₹29')).toBeVisible();
    await expect(customerPage.locator('#checkout-cart-summary').getByText('+₹20')).toBeVisible();

    const totalAfter = await customerPage.getByText(/To Pay ₹\d+/).textContent();
    expect(parseTotal(totalAfter) - parseTotal(totalBefore)).toBe(49); // +29 Express, +20 tip

    // Regression: the receipt must show the applied offer too, not just the checkout
    // screen — this exact gap shipped once (checkout showed it, the receipt never did)
    // before it was caught by hand and fixed.
    await customerPage.getByPlaceholder('Flat / house number, street, landmark').fill('Offer Test Delivery Address');
    await customerPage.getByRole('button', { name: 'Place order' }).click();
    await expect(customerPage.getByText('Estimated delivery')).toBeVisible();

    const customerLogin = await api.post('/auth/login', { data: { phone: customerPhone, password: 'testpass123' } });
    const { accessToken: customerAccessToken } = await customerLogin.json();
    const myOrders = await (await api.get('/orders', { headers: { Authorization: `Bearer ${customerAccessToken}` } })).json();
    const offerOrderId = myOrders[0].id;
    const advance = (token: string, status: string) =>
      api.patch(`/orders/${offerOrderId}/status`, { headers: { Authorization: `Bearer ${token}` }, data: { status } });
    await advance(restaurantToken, 'accepted');
    await advance(restaurantToken, 'preparing');
    await advance(restaurantToken, 'ready_for_pickup');
    await api.post(`/orders/${offerOrderId}/assign-rider/${riderId}`, { headers: { Authorization: `Bearer ${restaurantToken}` } });
    await advance(riderToken, 'picked_up');
    await advance(riderToken, 'delivered');

    // The customer never left this order's live tracking screen — same pattern as the
    // main flow's delivery step, updates arrive via socket without any navigation.
    // Scoped to the status ladder — the receipt (below) also says "Delivered", which
    // already caused a strict-mode collision once earlier in this same file.
    await expect(customerPage.locator('.tiffin-tier.current', { hasText: 'Delivered' })).toBeVisible({ timeout: 15_000 });
    await expect(customerPage.getByText('🎉 Big Save')).toBeVisible();
    await expect(customerPage.getByText('-₹40')).toBeVisible();
  });

  await test.step('History warns about closed restaurants and unavailable items', async () => {
    // Restaurant goes offline (the Phase 3 toggle) and the dish sells out
    const offline = await api.patch(`/restaurants/${restaurantId}`, {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { isOpen: false },
    });
    expect(offline.ok()).toBeTruthy();
    const soldOut = await api.patch(`/menu-items/${menuItemId}`, {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { isAvailable: false },
    });
    expect(soldOut.ok()).toBeTruthy();

    // The customer's history row says so upfront — scoped to .first() since this
    // restaurant now has two delivered orders in history (the original, and the Phase L1
    // offer-test order added later in this same test), both correctly showing the pill
    await customerPage.reload();
    await customerPage.getByRole('button', { name: '📋 Orders' }).click();
    await expect(customerPage.getByText('Closed now').first()).toBeVisible();

    // "View menu" browses the restaurant without force-filling a cart
    await customerPage.getByRole('button', { name: 'View menu', exact: true }).first().click();
    await expect(customerPage.getByText('E2E Test Dish')).toBeVisible();
    // The rating left earlier is now public social proof on the menu page
    await expect(customerPage.getByText('Reviews (1)')).toBeVisible();
    await expect(customerPage.getByText('Best biryani in Uppal!')).toBeVisible();
    // Privacy: the reviewer appears by FIRST NAME ONLY — the review byline says 'E2E',
    // and the full signup name appears nowhere on the page
    await expect(customerPage.locator('strong').filter({ hasText: /^E2E$/ })).toBeVisible();
    await expect(customerPage.getByText('E2E Test Customer')).toHaveCount(0);

    // Reorder is honest about what it couldn't re-add
    await customerPage.getByRole('button', { name: '← Back' }).click();
    await customerPage.getByRole('button', { name: '📋 Orders' }).click();
    await customerPage.getByRole('button', { name: /🔁 Reorder/ }).first().click();
    await expect(customerPage.getByText(/no\s*longer available/)).toBeVisible();
  });

  await test.step('Restaurant sees the delivered order in Order History', async () => {
    await restaurantPage.getByRole('button', { name: 'Order History' }).click();
    // Summary cards render with real numbers — and exactly ONE rupee symbol on Revenue
    // (regression: the card once rendered "₹ ₹2,390" because both the icon and the
    // formatted value carried the symbol)
    await expect(restaurantPage.getByText(/💰\s*₹[\d,]+/)).toBeVisible();
    await expect(restaurantPage.getByText(/₹\s*₹/)).toHaveCount(0);
    // Summary card and the order row itself, with the customer who placed it — scoped to
    // .first() since the same test customer now has two delivered orders here (the
    // original, and the Phase L1 offer-test order)
    await expect(restaurantPage.getByText('E2E Test Customer').first()).toBeVisible();
    await expect(restaurantPage.locator('.pill.status-delivered').first()).toBeVisible();
    // COD + delivered = paid, and the row is marked as a cash order
    await expect(restaurantPage.getByText('💵 COD').first()).toBeVisible();
    await expect(restaurantPage.locator('.pill').filter({ hasText: /^paid$/ }).first()).toBeVisible();
    // Expanding the row shows what was ordered
    await restaurantPage.getByText('E2E Test Customer').first().click();
    await expect(restaurantPage.getByText(/E2E Test Dish × 1/).first()).toBeVisible();
  });

  await test.step('Phase J: a dish with a required variant group prices and orders correctly through the picker', async () => {
    // The earlier "closed restaurant" step took this restaurant offline to test the
    // Closed-now tag, and the customer search endpoint correctly excludes offline
    // restaurants (WHERE isOpen = true) — bring it back online or it can never be found.
    const backOnline = await api.patch(`/restaurants/${restaurantId}`, {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { isOpen: true },
    });
    expect(backOnline.ok()).toBeTruthy();

    // A second dish on the same restaurant, kept separate from E2E Test Dish so this
    // doesn't disturb any of the existing price/label assertions built around that one
    const variantDishRes = await api.post('/menu-items', {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: { restaurantId, name: 'E2E Variant Dish', price: 150, category: 'main' },
    });
    const variantDishId = (await variantDishRes.json()).id;
    const groupRes = await api.post(`/menu-items/${variantDishId}/variant-groups`, {
      headers: { Authorization: `Bearer ${restaurantToken}` },
      data: {
        name: 'Size',
        required: true,
        selectionType: 'single',
        options: [
          { label: 'Small', priceDelta: 0 },
          { label: 'Large', priceDelta: 50 },
        ],
      },
    });
    expect(groupRes.ok()).toBeTruthy();

    // The previous step reached this restaurant via the Orders tab (its Reorder click),
    // and MenuScreen's onBack only clears selectedRestaurant — it doesn't reset which tab
    // is active. So Back alone lands on Order History again, not the search screen; the
    // Browse tab has to be clicked explicitly once the bottom nav reappears.
    await customerPage.getByRole('button', { name: '← Back' }).click();
    await customerPage.getByRole('button', { name: '🍲 Browse' }).click();
    await customerPage.getByPlaceholder('Search by name, cuisine, or dish…').fill(restaurantName);
    await customerPage.getByText(restaurantName).click();
    await customerPage.getByText('E2E Variant Dish').waitFor();

    // "Add" on a variant dish opens the picker rather than adding directly
    const dishCard = customerPage.locator('.card', { hasText: 'E2E Variant Dish' });
    await dishCard.getByRole('button', { name: 'Add' }).click();
    await expect(customerPage.getByText('Size')).toBeVisible();

    // "Add to cart" is disabled until the required group has a selection
    await expect(customerPage.getByRole('button', { name: /Add to cart/ })).toBeDisabled();
    // Regression: the option's price badge ("+₹50") uses .muted, which is light-on-dark
    // globally — inside the picker's light "paper" card it was rendering but invisible,
    // same bug class as the receipt labels earlier. Assert the actual computed color,
    // not just presence, since "in the DOM but unreadable" is exactly what slipped through.
    // exact:true — same nested-label ambiguity as the 'Large' click below: the row's own
    // combined text ("Large +₹50") would also substring-match, since the price badge is a
    // sibling span inside that same label
    await expect(customerPage.getByText('+₹50', { exact: true })).toHaveCSS('color', 'rgb(107, 97, 86)');
    // exact:true — the option row's price badge ("+₹50") is a sibling, but the label
    // wraps both, so a substring match on 'Large' would ambiguously hit both the row's
    // own text and the option-name span nested inside it
    await customerPage.getByText('Large', { exact: true }).click();
    // Price updates live as the option is picked: base 150 + delta 50 = 200
    await expect(customerPage.getByRole('button', { name: 'Add to cart · ₹200' })).toBeEnabled();
    await customerPage.getByRole('button', { name: 'Add to cart · ₹200' }).click();

    // The cart line under the dish shows the chosen variant and its price
    await expect(customerPage.getByText('Large · ₹200')).toBeVisible();
    await expect(customerPage.getByRole('button', { name: /View cart · 1 item · ₹200/ })).toBeVisible();

    // Checkout carries the selection through, correctly priced — one combined regex
    // targeting the line's own text, since a substring check for just "(Large)" would
    // ambiguously match both the line and its nested variant-label span
    await customerPage.getByRole('button', { name: /View cart/ }).click();
    await expect(customerPage.getByText(/E2E Variant Dish.*\(Large\)/)).toBeVisible();
    // Regression: same contrast bug as the picker's price badge — checkout's variant
    // label also uses .muted inside a light card and was genuinely invisible, not (as
    // first assumed from a screenshot) a stale-tab caching artifact
    await expect(customerPage.locator('#checkout-cart-summary .muted').first()).toHaveCSS('color', 'rgb(107, 97, 86)');
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

    await customerPage.getByPlaceholder('Search by name, cuisine, or dish…').fill(restaurantName);
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
    // Phase C: the banner now states WHO cancelled, not just that it happened — this is a
    // customer-initiated cancel, so it must say "You cancelled", not the generic old wording
    await expect(customerPage.getByText('You cancelled this order.')).toBeVisible({ timeout: 10_000 });
  });

  await customerContext.close();
});
