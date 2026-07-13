import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';

/**
 * Packaging fee — genuinely restaurant-specific (Restaurant.packagingFee, set via the
 * restaurant's own Settings screen), NOT a platform-wide env var like platform fee/GST.
 * The platform still enforces a hard ceiling (PACKAGING_FEE_CAP) so no restaurant can
 * stack an excessive charge — matches the Zomato-style "restaurant sets it, platform
 * caps it" model, chosen deliberately over Swiggy's uncapped per-item accumulation.
 */
describe('Packaging fee (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(() => {
    delete process.env.PACKAGING_FEE_CAP;
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApprovedRestaurantWithDish(packagingFee?: number, price = 200) {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    if (packagingFee !== undefined) {
      await request(app.getHttpServer())
        .patch(`/restaurants/${restaurant.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ packagingFee })
        .expect(200);
    }
    const item = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Packaging Test Dish', price, category: 'main' })
      .expect(201);
    return { restaurant, menuItemId: item.body.id };
  }

  function placeOrder(restaurantId: string, customer: any, menuItemId: string) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryAddress: 'Packaging Test Address',
        latitude: 17.45,
        longitude: 78.39,
      });
  }

  it('a restaurant with no packaging fee set charges nothing extra', async () => {
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    expect(Number(order.body.packagingFeeAmount)).toBe(0);
  });

  it('reflects the restaurant\'s own configured packaging fee', async () => {
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(8);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    expect(Number(order.body.packagingFeeAmount)).toBe(8);
    expect(Number(order.body.total)).toBe(Number(order.body.subtotal) + Number(order.body.deliveryFee) + 8);
  });

  it('two different restaurants can have two genuinely different packaging fees at once', async () => {
    // Proves this is truly per-restaurant, not a global setting one restaurant's config
    // would leak into another's
    const a = await setupApprovedRestaurantWithDish(5);
    const b = await setupApprovedRestaurantWithDish(15);
    const customer = await signUpCustomer(app);
    const orderA = await placeOrder(a.restaurant.id, customer, a.menuItemId).expect(201);
    const orderB = await placeOrder(b.restaurant.id, customer, b.menuItemId).expect(201);
    expect(Number(orderA.body.packagingFeeAmount)).toBe(5);
    expect(Number(orderB.body.packagingFeeAmount)).toBe(15);
  });

  it('clamps a restaurant-set fee above the platform cap down to the cap, not rejected outright', async () => {
    process.env.PACKAGING_FEE_CAP = '30';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(999);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    // Clamped, not rejected — a cap lowered later shouldn't strand an existing setting
    expect(Number(order.body.packagingFeeAmount)).toBe(30);
  });

  it('the platform cap itself is configurable', async () => {
    process.env.PACKAGING_FEE_CAP = '10';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(999);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    expect(Number(order.body.packagingFeeAmount)).toBe(10);
  });

  it('a fee under the cap is charged in full, untouched', async () => {
    process.env.PACKAGING_FEE_CAP = '30';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(12);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    expect(Number(order.body.packagingFeeAmount)).toBe(12);
  });

  it('the checkout preview endpoint shows the same clamped packaging fee before the order is placed', async () => {
    process.env.PACKAGING_FEE_CAP = '30';
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(999);
    const customer = await signUpCustomer(app);
    const res = await request(app.getHttpServer())
      .post('/offers/preview')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, subtotal: 200, latitude: 17.45, longitude: 78.39 })
      .expect(201);
    expect(Number(res.body.packagingFeeAmount)).toBe(30);
  });

  it('rejects a negative packaging fee at the restaurant-settings level', async () => {
    const restaurant = await signUpRestaurant(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ packagingFee: -5 })
      .expect(400);
  });

  it('commission is still based on subtotal only, never inflated by the restaurant\'s own packaging fee', async () => {
    const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(20, 200);
    const customer = await signUpCustomer(app);
    const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    // commissionRate defaults to 20% — 200 × 20% = 40, unaffected by the ₹20 packaging fee
    expect(Number(order.body.commissionAmount)).toBe(40);
  });
});
