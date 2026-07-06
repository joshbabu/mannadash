import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, signUpCustomer, signUpRestaurant, signUpRider, adminLogin } from './test-helpers';

describe('Ratings (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function deliverAFreshOrder() {
    const customer = await signUpCustomer(app);
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

    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Test Item', price: 100, category: 'main' })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: menuItem.body.id, quantity: 1 }],
        deliveryAddress: 'Test address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);
    const orderId = order.body.id;

    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'accepted' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'preparing' }).expect(200);
    await request(app.getHttpServer()).patch(`/delivery-partners/me/availability`).set('Authorization', `Bearer ${rider.token}`).send({ isAvailable: true }).expect(200);
    await request(app.getHttpServer()).post(`/orders/${orderId}/assign-rider/${rider.id}`).set('Authorization', `Bearer ${restaurant.token}`).expect(201);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'ready_for_pickup' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${rider.token}`).send({ status: 'picked_up' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${rider.token}`).send({ status: 'delivered' }).expect(200);

    return { customer, restaurant, rider, orderId };
  }

  it('blocks rating an order that has not been delivered yet', async () => {
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
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId: menuItem.body.id, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/orders/${order.body.id}/rating`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantRating: 5, deliveryRating: 5 })
      .expect(400);
  });

  it('accepts a rating after delivery and blocks a duplicate rating', async () => {
    const { customer, orderId } = await deliverAFreshOrder();

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/rating`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantRating: 5, deliveryRating: 4 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/rating`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantRating: 1, deliveryRating: 1 })
      .expect(400);
  });

  it('correctly averages two ratings for the same restaurant', async () => {
    const first = await deliverAFreshOrder();
    await request(app.getHttpServer())
      .post(`/orders/${first.orderId}/rating`)
      .set('Authorization', `Bearer ${first.customer.token}`)
      .send({ restaurantRating: 5, deliveryRating: 5 })
      .expect(201);

    // Second order, same restaurant/rider, different customer — reuse the restaurant by
    // placing a second order through it rather than creating a brand new one
    const secondCustomer = await signUpCustomer(app);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${first.restaurant.token}`)
      .send({ restaurantId: first.restaurant.id, name: 'Second Item', price: 50, category: 'main' })
      .expect(201);
    const order2 = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${secondCustomer.token}`)
      .send({ restaurantId: first.restaurant.id, items: [{ menuItemId: menuItem.body.id, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    const orderId2 = order2.body.id;

    await request(app.getHttpServer()).patch(`/orders/${orderId2}/status`).set('Authorization', `Bearer ${first.restaurant.token}`).send({ status: 'accepted' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId2}/status`).set('Authorization', `Bearer ${first.restaurant.token}`).send({ status: 'preparing' }).expect(200);
    await request(app.getHttpServer()).post(`/orders/${orderId2}/assign-rider/${first.rider.id}`).set('Authorization', `Bearer ${first.restaurant.token}`).expect(201);
    await request(app.getHttpServer()).patch(`/orders/${orderId2}/status`).set('Authorization', `Bearer ${first.restaurant.token}`).send({ status: 'ready_for_pickup' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId2}/status`).set('Authorization', `Bearer ${first.rider.token}`).send({ status: 'picked_up' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId2}/status`).set('Authorization', `Bearer ${first.rider.token}`).send({ status: 'delivered' }).expect(200);

    await request(app.getHttpServer())
      .post(`/orders/${orderId2}/rating`)
      .set('Authorization', `Bearer ${secondCustomer.token}`)
      .send({ restaurantRating: 3, deliveryRating: 3 })
      .expect(201);

    const restaurantAfter = await request(app.getHttpServer()).get(`/restaurants/${first.restaurant.id}`).expect(200);
    expect(Number(restaurantAfter.body.ratingAvg)).toBe(4); // (5 + 3) / 2
    expect(restaurantAfter.body.ratingCount).toBe(2);
  });

  it('blocks a non-admin from running the ratings backfill', async () => {
    const restaurant = await signUpRestaurant(app);
    await request(app.getHttpServer())
      .post('/orders/admin/backfill-rating-stats')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(403);
  });
});
