import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';

/**
 * Restaurant-page "spice pack" backend: cooking instructions travel from checkout to the
 * kitchen, and the public reviews endpoint surfaces rating comments as social proof —
 * with the privacy rule that reviewers appear as FIRST NAME ONLY (no phone, no user object).
 */
describe('Cooking instructions & public reviews (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setup() {
    const restaurant = await signUpRestaurant(app);
    const rider = await signUpRider(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/delivery-partners/${rider.id}/verify`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/delivery-partners/me/availability')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ isAvailable: true })
      .expect(200);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Spice Test Dish', price: 150, category: 'main' })
      .expect(201);
    return { restaurant, rider, menuItemId: menuItem.body.id };
  }

  function placeOrder(ctx: any, customer: any, extra: Record<string, any> = {}) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: ctx.restaurant.id,
        items: [{ menuItemId: ctx.menuItemId, quantity: 1 }],
        deliveryAddress: 'Spice Test Address',
        latitude: 17.45,
        longitude: 78.39,
        ...extra,
      });
  }

  it('carries cooking instructions from checkout to the kitchen, and enforces the length cap', async () => {
    const ctx = await setup();
    const customer = await signUpCustomer(app);
    const order = await placeOrder(ctx, customer, { instructions: 'Less spicy, no onions please' }).expect(201);
    expect(order.body.instructions).toBe('Less spicy, no onions please');

    // The kitchen actually sees it: it's on the restaurant's live order feed
    const feed = await request(app.getHttpServer())
      .get('/orders/restaurant/mine')
      .set('Authorization', `Bearer ${ctx.restaurant.token}`)
      .expect(200);
    const mine = feed.body.find((o: any) => o.id === order.body.id);
    expect(mine.instructions).toBe('Less spicy, no onions please');

    await placeOrder(ctx, customer, { instructions: 'x'.repeat(301) }).expect(400);
  });

  describe('public reviews', () => {
    it('lists comments with first names only — never phone numbers or user objects', async () => {
      const ctx = await setup();
      const customer = await signUpCustomer(app, 'Ravi Kumar Reddy');
      const order = await placeOrder(ctx, customer).expect(201);

      // full lifecycle to delivered, then rate with a comment
      const t = (token: string, status: string) =>
        request(app.getHttpServer())
          .patch(`/orders/${order.body.id}/status`)
          .set('Authorization', `Bearer ${token}`)
          .send({ status })
          .expect(200);
      await t(ctx.restaurant.token, 'accepted');
      await t(ctx.restaurant.token, 'preparing');
      await request(app.getHttpServer())
        .post(`/orders/${order.body.id}/assign-rider/${ctx.rider.id}`)
        .set('Authorization', `Bearer ${ctx.restaurant.token}`)
        .expect(201);
      await t(ctx.restaurant.token, 'ready_for_pickup');
      await t(ctx.rider.token, 'picked_up');
      await t(ctx.rider.token, 'delivered');
      await request(app.getHttpServer())
        .post(`/orders/${order.body.id}/rating`)
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ restaurantRating: 5, deliveryRating: 4, comment: 'Best biryani in Uppal!' })
        .expect(201);

      // Public — no auth header at all
      const res = await request(app.getHttpServer()).get(`/orders/restaurant/${ctx.restaurant.id}/reviews`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].comment).toBe('Best biryani in Uppal!');
      expect(res.body[0].restaurantRating).toBe(5);
      expect(res.body[0].customerName).toBe('Ravi'); // first name only
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(customer.phone);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('Kumar Reddy'); // rest of the name stays private too
    });

    it('returns an empty list for a restaurant with no ratings', async () => {
      const ctx = await setup();
      const res = await request(app.getHttpServer()).get(`/orders/restaurant/${ctx.restaurant.id}/reviews`).expect(200);
      expect(res.body).toEqual([]);
    });
  });
});
