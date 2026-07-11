import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, signUpCustomer, signUpRestaurant, signUpRider, adminLogin, markOrderAsPaid } from './test-helpers';

describe('Operating hours, payouts, and refunds (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks placing an order outside the restaurant\'s operating hours', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);

    // A 1-hour window guaranteed not to include right now
    const now = new Date();
    const closedStart = `${String((now.getHours() + 1) % 24).padStart(2, '0')}:00`;
    const closedEnd = `${String((now.getHours() + 2) % 24).padStart(2, '0')}:00`;
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ openTime: closedStart, closeTime: closedEnd })
      .expect(200);

    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Test Item', price: 100, category: 'main' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: menuItem.body.id, quantity: 1 }],
        deliveryAddress: 'x',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(400);
  });

  it('lets a customer cancel their own order before acceptance, but not after', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Test Item', price: 100, category: 'main' })
      .expect(201);

    // First order: cancel while still "placed" — should succeed
    const order1 = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId: menuItem.body.id, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/orders/${order1.body.id}/status`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ status: 'cancelled' })
      .expect(200);

    // Second order: restaurant accepts, then customer tries to cancel — should be blocked
    const order2 = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId: menuItem.body.id, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/orders/${order2.body.id}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'accepted' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${order2.body.id}/status`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ status: 'cancelled' })
      .expect(403);
  });

  it('tracks pending payout correctly and prevents double-paying the same delivery', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await signUpRestaurant(app);
    const rider = await signUpRider(app);
    const admin = await adminLogin(app);

    await request(app.getHttpServer()).patch(`/restaurants/${restaurant.id}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'approved' }).expect(200);
    await request(app.getHttpServer()).patch(`/delivery-partners/${rider.id}/verify`).set('Authorization', `Bearer ${admin}`).expect(200);
    const menuItem = await request(app.getHttpServer()).post('/menu-items').set('Authorization', `Bearer ${restaurant.token}`).send({ restaurantId: restaurant.id, name: 'Test Item', price: 100, category: 'main' }).expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId: menuItem.body.id, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    const orderId = order.body.id;

    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'accepted' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'preparing' }).expect(200);
    await request(app.getHttpServer()).patch(`/delivery-partners/me/availability`).set('Authorization', `Bearer ${rider.token}`).send({ isAvailable: true }).expect(200);
    await request(app.getHttpServer()).post(`/orders/${orderId}/assign-rider/${rider.id}`).set('Authorization', `Bearer ${restaurant.token}`).expect(201);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'ready_for_pickup' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${rider.token}`).send({ status: 'picked_up' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${rider.token}`).send({ status: 'delivered' }).expect(200);

    // Phase E: delivery fee is now distance-tiered, not a flat ₹30. This order's ~1.5km
    // distance falls in the base tier (₹25) — see delivery-fee.util.ts.
    const earningsBefore = await request(app.getHttpServer()).get('/orders/rider/earnings').set('Authorization', `Bearer ${rider.token}`).expect(200);
    expect(earningsBefore.body.pendingPayout).toBe(25);

    // Non-admin cannot issue a payout
    await request(app.getHttpServer()).post(`/orders/rider/${rider.id}/payout`).set('Authorization', `Bearer ${rider.token}`).expect(403);

    // Admin issues it
    const payoutRes = await request(app.getHttpServer()).post(`/orders/rider/${rider.id}/payout`).set('Authorization', `Bearer ${admin}`).expect(201);
    expect(payoutRes.body.amount).toBe(25);

    const earningsAfter = await request(app.getHttpServer()).get('/orders/rider/earnings').set('Authorization', `Bearer ${rider.token}`).expect(200);
    expect(earningsAfter.body.pendingPayout).toBe(0);

    // Running it again with nothing pending is rejected — can never double-pay
    await request(app.getHttpServer()).post(`/orders/rider/${rider.id}/payout`).set('Authorization', `Bearer ${admin}`).expect(400);
  });

  it('auto-flags a refund as pending when a PAID order is cancelled, and lets admin complete it', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer()).patch(`/restaurants/${restaurant.id}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'approved' }).expect(200);
    const menuItem = await request(app.getHttpServer()).post('/menu-items').set('Authorization', `Bearer ${restaurant.token}`).send({ restaurantId: restaurant.id, name: 'Test Item', price: 100, category: 'main' }).expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId: menuItem.body.id, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    const orderId = order.body.id;

    // Simulate a real payment succeeding (can't call the real Razorpay flow in tests)
    await markOrderAsPaid(app, orderId);

    // Restaurant accepts, then cancels — a paid order being cancelled should auto-flag a refund
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'accepted' }).expect(200);
    const cancelled = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'cancelled' })
      .expect(200);
    expect(cancelled.body.refundStatus).toBe('pending');
    expect(Number(cancelled.body.refundAmount)).toBe(Number(cancelled.body.total));

    // Non-admin cannot complete the refund
    await request(app.getHttpServer()).post(`/orders/${orderId}/complete-refund`).set('Authorization', `Bearer ${customer.token}`).expect(403);

    // Admin completes it
    const completed = await request(app.getHttpServer()).post(`/orders/${orderId}/complete-refund`).set('Authorization', `Bearer ${admin}`).expect(201);
    expect(completed.body.refundStatus).toBe('completed');

    // Can't complete the same refund twice
    await request(app.getHttpServer()).post(`/orders/${orderId}/complete-refund`).set('Authorization', `Bearer ${admin}`).expect(400);
  });

  it('does NOT flag a refund when cancelling an order that was never paid', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer()).patch(`/restaurants/${restaurant.id}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'approved' }).expect(200);
    const menuItem = await request(app.getHttpServer()).post('/menu-items').set('Authorization', `Bearer ${restaurant.token}`).send({ restaurantId: restaurant.id, name: 'Test Item', price: 100, category: 'main' }).expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId: menuItem.body.id, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
      .expect(201);

    // Cancel while still "placed", via the customer — no payment was ever made
    const cancelled = await request(app.getHttpServer())
      .patch(`/orders/${order.body.id}/status`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ status: 'cancelled' })
      .expect(200);
    expect(cancelled.body.refundStatus).toBe('none');
    expect(cancelled.body.refundAmount).toBeNull();
  });
});
