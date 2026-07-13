import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';

/**
 * Platform fee + GST. Two genuinely different things: platform fee is MannaDash's own
 * charge and can be turned on any time; GST is real tax law and MUST stay at zero until
 * the platform is actually registered — the whole point of this spec is proving that
 * "not configured" means "genuinely zero", never a silent fallback to some nonzero rate.
 *
 * One shared app instance throughout: computeTaxesAndFees() reads process.env fresh at
 * the moment an order is created, not at app-bootstrap time, so env vars can be set/unset
 * around individual tests without needing (and leaking) a fresh app per scenario.
 */
describe('Platform fee & GST (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(() => {
    delete process.env.PLATFORM_FEE_AMOUNT;
    delete process.env.PACKAGING_FEE_AMOUNT;
    delete process.env.GST_ENABLED;
    delete process.env.GST_RESTAURANT_RATE_PERCENT;
    delete process.env.GST_DELIVERY_RATE_PERCENT;
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApprovedRestaurantWithDish(price = 200) {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    const item = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'GST Test Dish', price, category: 'main' })
      .expect(201);
    return { restaurant, menuItemId: item.body.id };
  }

  function placeOrder(restaurantId: string, customer: any, menuItemId: string, extra: Record<string, any> = {}) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryAddress: 'GST Test Address',
        latitude: 17.45,
        longitude: 78.39,
        ...extra,
      });
  }

  it('charges nothing extra by default — genuinely zero, not a silent fallback', async () => {
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    expect(Number(order.body.platformFeeAmount)).toBe(0);
    expect(Number(order.body.packagingFeeAmount)).toBe(0);
    expect(Number(order.body.restaurantGstAmount)).toBe(0);
    expect(Number(order.body.deliveryGstAmount)).toBe(0);
    expect(Number(order.body.total)).toBe(Number(order.body.subtotal) + Number(order.body.deliveryFee));
  });

  it('rejects the request outright if a client tries to send GST-like fields — stronger than silently ignoring them', async () => {
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
    const customer = await signUpCustomer(app);
    // forbidNonWhitelisted on the ValidationPipe rejects any property CreateOrderDto
    // doesn't declare — these four simply aren't fields a client can set at all, which is
    // a stronger guarantee than "computed server-side, client value silently ignored"
    await placeOrder(restaurant.id, customer, menuItemId, {
      platformFeeAmount: 999,
      packagingFeeAmount: 999,
      restaurantGstAmount: 999,
      deliveryGstAmount: 999,
    }).expect(400);
  });

  it('packaging fee is flat per order, independent of both platform fee and GST', async () => {
    process.env.PACKAGING_FEE_AMOUNT = '6';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    expect(Number(order.body.packagingFeeAmount)).toBe(6);
    expect(Number(order.body.platformFeeAmount)).toBe(0); // unset, proves independence
    expect(Number(order.body.total)).toBe(Number(order.body.subtotal) + Number(order.body.deliveryFee) + 6);
  });

  it('packaging fee stays the same flat amount regardless of how many items are in the order', async () => {
    process.env.PACKAGING_FEE_AMOUNT = '6';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId, {
      items: [{ menuItemId, quantity: 5 }],
    }).expect(201);
    expect(Number(order.body.packagingFeeAmount)).toBe(6); // flat, not 6 × 5
  });

  it('platform fee can be enabled independently of GST — it is not a tax', async () => {
    process.env.PLATFORM_FEE_AMOUNT = '3';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    expect(Number(order.body.platformFeeAmount)).toBe(3);
    expect(Number(order.body.restaurantGstAmount)).toBe(0);
    expect(Number(order.body.total)).toBe(Number(order.body.subtotal) + Number(order.body.deliveryFee) + 3);
  });

  it('computes real GST once enabled, and includes it in the total', async () => {
    process.env.GST_ENABLED = 'true';
    process.env.GST_RESTAURANT_RATE_PERCENT = '5';
    process.env.GST_DELIVERY_RATE_PERCENT = '18';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    const expectedRestaurantGst = Math.round(200 * 0.05 * 100) / 100;
    const expectedDeliveryGst = Math.round(Number(order.body.deliveryFee) * 0.18 * 100) / 100;
    expect(Number(order.body.restaurantGstAmount)).toBe(expectedRestaurantGst);
    expect(Number(order.body.deliveryGstAmount)).toBe(expectedDeliveryGst);
    expect(Number(order.body.total)).toBe(
      Number(order.body.subtotal) + Number(order.body.deliveryFee) + expectedRestaurantGst + expectedDeliveryGst,
    );
  });

  it('commission stays based on subtotal only, never inflated by GST or platform fee', async () => {
    process.env.PLATFORM_FEE_AMOUNT = '3';
    process.env.GST_ENABLED = 'true';
    process.env.GST_RESTAURANT_RATE_PERCENT = '5';
    process.env.GST_DELIVERY_RATE_PERCENT = '18';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    // commissionRate defaults to 20% unless overridden at signup — 200 × 20% = 40, which
    // must hold regardless of platform fee/GST being added on top for the customer
    expect(Number(order.body.commissionAmount)).toBe(40);
  });

  it('GST on delivery is computed from the real fee, before any offer discount is subtracted', async () => {
    process.env.GST_ENABLED = 'true';
    process.env.GST_DELIVERY_RATE_PERCENT = '18';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Free Delivery', discountType: 'free_delivery' })
      .expect(201);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    const expectedDeliveryGst = Math.round(Number(order.body.deliveryFee) * 0.18 * 100) / 100;
    expect(Number(order.body.deliveryGstAmount)).toBe(expectedDeliveryGst);
    expect(Number(order.body.deliveryGstAmount)).toBeGreaterThan(0);
  });
});
