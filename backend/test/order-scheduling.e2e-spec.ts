import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';

describe('Order scheduling — "order for later" (e2e)', () => {
  let app: INestApplication;

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
    const item = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Schedule Test Dish', price: 200, category: 'main' })
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
        deliveryAddress: 'Schedule Test Address',
        latitude: 17.45,
        longitude: 78.39,
        ...extra,
      });
  }

  it('an order with no scheduledFor behaves exactly as before — asap, scheduledFor null', async () => {
    const customer = await signUpCustomer(app);
    const { restaurant, menuItemId } = await setupApprovedRestaurant();
    const res = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
    expect(res.body.scheduledFor).toBeNull();
  });

  it('accepts a valid future scheduled time and returns it on the order', async () => {
    const customer = await signUpCustomer(app);
    const { restaurant, menuItemId } = await setupApprovedRestaurant();
    const scheduledFor = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h from now
    const res = await placeOrder(restaurant.id, customer, menuItemId, { scheduledFor }).expect(201);
    expect(new Date(res.body.scheduledFor).getTime()).toBe(new Date(scheduledFor).getTime());
  });

  it('rejects a scheduled time less than 30 minutes away — indistinguishable from asap otherwise', async () => {
    const customer = await signUpCustomer(app);
    const { restaurant, menuItemId } = await setupApprovedRestaurant();
    const tooSoon = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min from now
    const res = await placeOrder(restaurant.id, customer, menuItemId, { scheduledFor: tooSoon }).expect(400);
    expect(res.body.message).toMatch(/at least 30 minutes/i);
  });

  it('rejects a scheduled time more than 7 days away', async () => {
    const customer = await signUpCustomer(app);
    const { restaurant, menuItemId } = await setupApprovedRestaurant();
    const tooFar = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
    const res = await placeOrder(restaurant.id, customer, menuItemId, { scheduledFor: tooFar }).expect(400);
    expect(res.body.message).toMatch(/cannot be more than 7 days/i);
  });

  it('rejects a scheduled time already in the past', async () => {
    const customer = await signUpCustomer(app);
    const { restaurant, menuItemId } = await setupApprovedRestaurant();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await placeOrder(restaurant.id, customer, menuItemId, { scheduledFor: past }).expect(400);
  });

  it('checks restaurant hours against the scheduled time, not the moment the request is made', async () => {
    const customer = await signUpCustomer(app);
    // Open only 9am-5pm every day — a real restriction, not the default always-open hours
    const { restaurant, menuItemId } = await setupApprovedRestaurant({
      weeklyHours: {
        monday: { open: '09:00', close: '17:00' },
        tuesday: { open: '09:00', close: '17:00' },
        wednesday: { open: '09:00', close: '17:00' },
        thursday: { open: '09:00', close: '17:00' },
        friday: { open: '09:00', close: '17:00' },
        saturday: { open: '09:00', close: '17:00' },
        sunday: { open: '09:00', close: '17:00' },
      },
    });

    // Find the next occurrence of 8pm (20:00) — reliably outside the 9-5 window regardless
    // of what day "now" happens to be when this test runs, and still within the 7-day cap
    const eightPm = new Date();
    eightPm.setDate(eightPm.getDate() + 1);
    eightPm.setHours(20, 0, 0, 0);

    const res = await placeOrder(restaurant.id, customer, menuItemId, { scheduledFor: eightPm.toISOString() }).expect(400);
    expect(res.body.message).toMatch(/won't be open at that time/i);
  });

  it('a malformed scheduledFor is rejected at the DTO level, not silently ignored', async () => {
    const customer = await signUpCustomer(app);
    const { restaurant, menuItemId } = await setupApprovedRestaurant();
    await placeOrder(restaurant.id, customer, menuItemId, { scheduledFor: 'not-a-real-date' }).expect(400);
  });

  it('the restaurant sees the scheduled time on its own order list', async () => {
    const customer = await signUpCustomer(app);
    const { restaurant, menuItemId } = await setupApprovedRestaurant();
    const scheduledFor = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const placed = await placeOrder(restaurant.id, customer, menuItemId, { scheduledFor }).expect(201);

    // GET /orders/:id checks against the customer's id, so a restaurant calling it
    // directly would get a 403 — restaurant/mine is the actual restaurant-facing list
    const res = await request(app.getHttpServer())
      .get('/orders/restaurant/mine')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(200);
    const found = res.body.find((o: any) => o.id === placed.body.id);
    expect(found).toBeTruthy();
    expect(new Date(found.scheduledFor).getTime()).toBe(new Date(scheduledFor).getTime());
  });
});
