import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, signUpCustomer, signUpRestaurant, signUpRider, adminLogin } from './test-helpers';

describe('Order lifecycle authority (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function placeOrderAndAccept() {
    const customer = await signUpCustomer(app);
    const restaurant = await signUpRestaurant(app);
    const rider = await signUpRider(app);
    const admin = await adminLogin(app);

    // Approve + verify so this restaurant/rider can actually operate
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
        deliveryAddress: 'Test delivery address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/orders/${order.body.id}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'accepted' })
      .expect(200);

    return { customer, restaurant, rider, orderId: order.body.id };
  }

  it('lets the restaurant accept and prepare an order', async () => {
    const { restaurant, orderId } = await placeOrderAndAccept();
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'preparing' })
      .expect(200);
  });

  it('blocks a restaurant from marking its own order as picked_up', async () => {
    const { restaurant, orderId } = await placeOrderAndAccept();
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'picked_up' })
      .expect(403);
  });

  it('blocks a restaurant from marking its own order as delivered', async () => {
    const { restaurant, orderId } = await placeOrderAndAccept();
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'delivered' })
      .expect(403);
  });

  it('blocks a rider from marking an order accepted (restaurant-only stage)', async () => {
    const { rider, orderId } = await placeOrderAndAccept();
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ status: 'preparing' })
      .expect(403);
  });

  it('lets the assigned rider mark picked_up then delivered', async () => {
    const { restaurant, rider, orderId } = await placeOrderAndAccept();

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'preparing' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/delivery-partners/me/availability`)
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ isAvailable: true })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/assign-rider/${rider.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'ready_for_pickup' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ status: 'picked_up' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ status: 'delivered' })
      .expect(200);
  });

  it('blocks a customer from viewing another customer\'s order', async () => {
    const { orderId } = await placeOrderAndAccept();
    const otherCustomer = await signUpCustomer(app);

    await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${otherCustomer.token}`)
      .expect(403);
  });

  describe('cutlery preference', () => {
    it('defaults to false when not specified, and persists true when requested', async () => {
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
        .send({ restaurantId: restaurant.id, name: 'Cutlery Test Dish', price: 100, category: 'main' })
        .expect(201);
      const customer = await signUpCustomer(app);

      const withoutCutlery = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          restaurantId: restaurant.id,
          items: [{ menuItemId: menuItem.body.id, quantity: 1 }],
          deliveryAddress: 'X',
          latitude: 17.45,
          longitude: 78.39,
        })
        .expect(201);
      expect(withoutCutlery.body.cutleryNeeded).toBe(false);

      const withCutlery = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          restaurantId: restaurant.id,
          items: [{ menuItemId: menuItem.body.id, quantity: 1 }],
          deliveryAddress: 'X',
          latitude: 17.45,
          longitude: 78.39,
          cutleryNeeded: true,
        })
        .expect(201);
      expect(withCutlery.body.cutleryNeeded).toBe(true);
    });
  });
});
