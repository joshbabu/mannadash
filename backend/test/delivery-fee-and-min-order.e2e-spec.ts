import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';
import { calculateDeliveryFee } from '../src/orders/delivery-fee.util';

/**
 * Phase E: delivery fee moved from a flat ₹30 to distance-tiered pricing (base fee close by,
 * a per-km rate further out, capped), and restaurants can set their own minimum order value.
 *
 * Distances are simulated by moving the delivery address north of the restaurant by a known
 * number of degrees latitude — 1° latitude ≈ 111.32km everywhere on Earth (longitude varies
 * with latitude, so only latitude deltas are used for predictable math). Test points sit
 * comfortably clear of the 3km/7km tier boundaries so small geodesic-model differences
 * between this test's haversine estimate and PostGIS's geography calculation can't flip
 * which tier a case lands in.
 */
describe('Delivery fee & minimum order (e2e)', () => {
  let app: INestApplication;

  const RESTAURANT_LAT = 17.44;
  const RESTAURANT_LNG = 78.38;
  const KM_PER_DEGREE_LAT = 111.32;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApprovedRestaurant(overrides: Record<string, any> = {}) {
    const restaurant = await signUpRestaurant(app, overrides);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Fee Test Dish', price: 100, category: 'main' })
      .expect(201);
    return { restaurant, menuItemId: menuItem.body.id };
  }

  function placeOrderAtDistanceKm(ctx: any, customer: any, distanceKm: number) {
    const latitude = RESTAURANT_LAT + distanceKm / KM_PER_DEGREE_LAT;
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: ctx.restaurant.id,
        items: [{ menuItemId: ctx.menuItemId, quantity: 1 }],
        deliveryAddress: 'Distance Test Address',
        latitude,
        longitude: RESTAURANT_LNG,
      });
  }

  describe('distance-tiered delivery fee', () => {
    it('charges the flat base fee inside the close-by tier', async () => {
      const ctx = await setupApprovedRestaurant();
      const customer = await signUpCustomer(app);
      const res = await placeOrderAtDistanceKm(ctx, customer, 1.2).expect(201);
      expect(Number(res.body.deliveryFee)).toBe(calculateDeliveryFee(1.2 * 1000));
      expect(Number(res.body.deliveryFee)).toBe(25);
    });

    it('charges the mid-tier per-km rate for a moderate distance', async () => {
      const ctx = await setupApprovedRestaurant();
      const customer = await signUpCustomer(app);
      const res = await placeOrderAtDistanceKm(ctx, customer, 5).expect(201);
      expect(Number(res.body.deliveryFee)).toBe(calculateDeliveryFee(5 * 1000));
      expect(Number(res.body.deliveryFee)).toBe(37); // 25 + (5-3)*6
    });

    it('charges the steeper far-tier rate for a long-haul order', async () => {
      const ctx = await setupApprovedRestaurant();
      const customer = await signUpCustomer(app);
      const res = await placeOrderAtDistanceKm(ctx, customer, 9).expect(201);
      expect(Number(res.body.deliveryFee)).toBe(calculateDeliveryFee(9 * 1000));
      expect(Number(res.body.deliveryFee)).toBe(65); // 25 + 4*6 + 2*8
    });

    it('caps the fee for a very long delivery', async () => {
      const ctx = await setupApprovedRestaurant();
      const customer = await signUpCustomer(app);
      const res = await placeOrderAtDistanceKm(ctx, customer, 25).expect(201);
      expect(Number(res.body.deliveryFee)).toBe(90);
    });

    it('total reflects the tiered fee, not the old flat ₹30', async () => {
      const ctx = await setupApprovedRestaurant();
      const customer = await signUpCustomer(app);
      const res = await placeOrderAtDistanceKm(ctx, customer, 5).expect(201);
      expect(Number(res.body.total)).toBe(Number(res.body.subtotal) + 37);
    });
  });

  describe('minimum order value', () => {
    it('is unset by default — no restriction on order size', async () => {
      const ctx = await setupApprovedRestaurant();
      const customer = await signUpCustomer(app);
      await placeOrderAtDistanceKm(ctx, customer, 1).expect(201); // ₹100 order, no minimum configured
    });

    it('blocks an order below the restaurant-configured minimum, with a clear message', async () => {
      const ctx = await setupApprovedRestaurant();
      await request(app.getHttpServer())
        .patch(`/restaurants/${ctx.restaurant.id}`)
        .set('Authorization', `Bearer ${ctx.restaurant.token}`)
        .send({ minOrderValue: 200 })
        .expect(200);

      const customer = await signUpCustomer(app);
      const res = await placeOrderAtDistanceKm(ctx, customer, 1).expect(400); // ₹100 dish, ₹200 minimum
      expect(res.body.message).toContain('minimum order of ₹200');
    });

    it('allows an order that meets the minimum exactly', async () => {
      const ctx = await setupApprovedRestaurant();
      await request(app.getHttpServer())
        .patch(`/restaurants/${ctx.restaurant.id}`)
        .set('Authorization', `Bearer ${ctx.restaurant.token}`)
        .send({ minOrderValue: 100 })
        .expect(200);

      const customer = await signUpCustomer(app);
      await placeOrderAtDistanceKm(ctx, customer, 1).expect(201); // ₹100 dish meets a ₹100 minimum
    });

    it('is public on the restaurant record, so the customer app can warn before checkout', async () => {
      const ctx = await setupApprovedRestaurant();
      await request(app.getHttpServer())
        .patch(`/restaurants/${ctx.restaurant.id}`)
        .set('Authorization', `Bearer ${ctx.restaurant.token}`)
        .send({ minOrderValue: 150 })
        .expect(200);

      const res = await request(app.getHttpServer()).get(`/restaurants/${ctx.restaurant.id}`).expect(200);
      expect(res.body.minOrderValue).toBe(150);
    });
  });
});
