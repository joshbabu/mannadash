import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, signUpRider, signUpCustomer, signUpRestaurant, adminLogin } from './test-helpers';

describe('Push notifications (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes the VAPID public key without requiring auth', async () => {
    const res = await request(app.getHttpServer()).get('/push/vapid-public-key').expect(200);
    expect(res.body).toHaveProperty('publicKey');
  });

  it('requires authentication to save a subscription', async () => {
    await request(app.getHttpServer())
      .post('/push/subscribe')
      .send({ subscription: { endpoint: 'https://example.com/fake', keys: { p256dh: 'x', auth: 'y' } } })
      .expect(401);
  });

  it('lets an authenticated rider save a subscription', async () => {
    const rider = await signUpRider(app);
    await request(app.getHttpServer())
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ subscription: { endpoint: 'https://example.com/fake', keys: { p256dh: 'x', auth: 'y' } } })
      .expect(201);
  });

  it('lets an authenticated customer save a subscription too — Phase G, same generic endpoint', async () => {
    const customer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ subscription: { endpoint: 'https://example.com/fake-customer', keys: { p256dh: 'x', auth: 'y' } } })
      .expect(201);
  });

  it('a customer subscription does not interfere with placing and progressing a real order', async () => {
    // The real regression risk from wiring customer push into updateStatus: a bug there
    // (wrong property access on order.customer.user.id, etc.) would throw and break the
    // whole status transition, not just silently fail to notify. This proves it doesn't.
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
      .send({ restaurantId: restaurant.id, name: 'Push Test Dish', price: 100, category: 'main' })
      .expect(201);
    const customer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ subscription: { endpoint: 'https://example.com/fake-customer-2', keys: { p256dh: 'x', auth: 'y' } } })
      .expect(201);
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId: item.body.id, quantity: 1 }], deliveryAddress: 'X', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    // Accept — this is the exact status change that now also fires a customer push
    await request(app.getHttpServer())
      .patch(`/orders/${order.body.id}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'accepted' })
      .expect(200);
  });

  describe('malformed VAPID key does not crash the app (real production incident)', () => {
    afterEach(() => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    });

    it('boots successfully even with a malformed (but non-empty) VAPID public key', async () => {
      // Tonight's actual outage: a copy-paste slip left VAPID_PUBLIC_KEY as literal
      // placeholder text, which made webpush.setVapidDetails() throw synchronously
      // inside PushService's constructor — uncaught, that crashed NestJS's entire
      // dependency-injection bootstrap, taking down the whole backend, not just push.
      process.env.VAPID_PUBLIC_KEY = '<paste the new public key here>';
      process.env.VAPID_PRIVATE_KEY = '<paste the new private key here>';

      let brokenApp: INestApplication | undefined;
      try {
        brokenApp = await createTestApp();
        // The app booting at all IS the assertion — this used to throw during bootstrap
        const res = await request(brokenApp.getHttpServer()).get('/push/vapid-public-key').expect(200);
        expect(res.body).toHaveProperty('publicKey');
      } finally {
        if (brokenApp) await brokenApp.close();
      }
    });
  });
});
