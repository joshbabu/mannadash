import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';

/**
 * GET /orders/rider/mine — the data behind the rider app's real "Navigate" and "Call"
 * buttons (see HomeScreen.jsx). What this exists to prove: pickupCoords/dropCoords are
 * real coordinates extracted from the actual PostGIS location columns (not placeholders),
 * they land on the correct order, and the customer's real phone number is present for the
 * in-app call button — without ever leaking anything from customer.user beyond what's
 * already exposed elsewhere (no password hash, etc.).
 */
describe('Rider order list — navigation coordinates and call numbers (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it("includes real pickup/drop coordinates and the customer's phone for an assigned order", async () => {
    const restaurant = await signUpRestaurant(app, { latitude: 17.5, longitude: 78.5 });
    const rider = await signUpRider(app);
    const admin = await adminLogin(app);

    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set(authed(admin))
      .send({ status: 'approved' })
      .expect(200);
    await request(app.getHttpServer()).patch(`/delivery-partners/${rider.id}/verify`).set(authed(admin)).expect(200);
    await request(app.getHttpServer())
      .patch('/delivery-partners/me/location')
      .set(authed(rider.token))
      .send({ latitude: 17.5, longitude: 78.5 })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/delivery-partners/me/availability')
      .set(authed(rider.token))
      .send({ isAvailable: true })
      .expect(200);

    const item = await request(app.getHttpServer())
      .post('/menu-items')
      .set(authed(restaurant.token))
      .send({ restaurantId: restaurant.id, name: 'Nav Test Dish', price: 150, category: 'main' })
      .expect(201);

    const customer = await signUpCustomer(app, 'Nav Test Customer');
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set(authed(customer.token))
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: item.body.id, quantity: 1 }],
        deliveryAddress: 'Nav Test Delivery Address',
        latitude: 17.6,
        longitude: 78.6,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/orders/${order.body.id}/status`)
      .set(authed(restaurant.token))
      .send({ status: 'accepted' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${order.body.id}/status`)
      .set(authed(restaurant.token))
      .send({ status: 'preparing' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${order.body.id}/status`)
      .set(authed(restaurant.token))
      .send({ status: 'ready_for_pickup' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/orders/${order.body.id}/assign-rider/${rider.id}`)
      .set(authed(restaurant.token))
      .expect(201);

    const mine = await request(app.getHttpServer()).get('/orders/rider/mine').set(authed(rider.token)).expect(200);
    const found = mine.body.find((o: any) => o.id === order.body.id);
    expect(found).toBeTruthy();

    // Real coordinates, not zero/placeholder — small tolerance for PostGIS float round-trip
    expect(found.pickupCoords.lat).toBeCloseTo(17.5, 2);
    expect(found.pickupCoords.lng).toBeCloseTo(78.5, 2);
    expect(found.dropCoords.lat).toBeCloseTo(17.6, 2);
    expect(found.dropCoords.lng).toBeCloseTo(78.6, 2);

    expect(found.customer.user.phone).toBe(customer.phone);
    expect(found.customer.user.passwordHash).toBeUndefined();
  });

  it("doesn't crash or attach coordinates when a rider has no orders yet", async () => {
    const rider = await signUpRider(app);
    const mine = await request(app.getHttpServer()).get('/orders/rider/mine').set(authed(rider.token)).expect(200);
    expect(mine.body).toEqual([]);
  });
});
