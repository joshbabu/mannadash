import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, signUpCustomer, signUpRestaurant, signUpRider, adminLogin } from './test-helpers';

describe('Discount pricing and bestseller badges (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores and returns an optional originalPrice for discount display', async () => {
    const restaurant = await signUpRestaurant(app);
    const created = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Chicken 65', price: 199, originalPrice: 299, category: 'starter' })
      .expect(201);
    expect(Number(created.body.originalPrice)).toBe(299);
    expect(Number(created.body.price)).toBe(199);
  });

  it('items without a discount have no originalPrice', async () => {
    const restaurant = await signUpRestaurant(app);
    const created = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Plain Item', price: 100, category: 'main' })
      .expect(201);
    expect(created.body.originalPrice).toBeNull();
  });

  it('marks the real top-selling items as bestsellers, and nothing else', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await signUpRestaurant(app);
    const rider = await signUpRider(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer()).patch(`/restaurants/${restaurant.id}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'approved' }).expect(200);
    await request(app.getHttpServer()).patch(`/delivery-partners/${rider.id}/verify`).set('Authorization', `Bearer ${admin}`).expect(200);

    const popularItem = await request(app.getHttpServer()).post('/menu-items').set('Authorization', `Bearer ${restaurant.token}`).send({ restaurantId: restaurant.id, name: 'Popular Dish', price: 100, category: 'main' }).expect(201);
    const unpopularItem = await request(app.getHttpServer()).post('/menu-items').set('Authorization', `Bearer ${restaurant.token}`).send({ restaurantId: restaurant.id, name: 'Unpopular Dish', price: 100, category: 'main' }).expect(201);

    // Deliver 2 orders of the popular item, 0 of the unpopular one
    for (let i = 0; i < 2; i++) {
      // Assignment correctly marks a rider unavailable — reset it before each iteration
      await request(app.getHttpServer()).patch('/delivery-partners/me/availability').set('Authorization', `Bearer ${rider.token}`).send({ isAvailable: true }).expect(200);
      const order = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ restaurantId: restaurant.id, items: [{ menuItemId: popularItem.body.id, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
        .expect(201);
      const orderId = order.body.id;
      await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'accepted' }).expect(200);
      await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'preparing' }).expect(200);
      await request(app.getHttpServer()).post(`/orders/${orderId}/assign-rider/${rider.id}`).set('Authorization', `Bearer ${restaurant.token}`).expect(201);
      await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'ready_for_pickup' }).expect(200);
      await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${rider.token}`).send({ status: 'picked_up' }).expect(200);
      await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${rider.token}`).send({ status: 'delivered' }).expect(200);
    }

    const menu = await request(app.getHttpServer()).get(`/menu-items?restaurantId=${restaurant.id}`).expect(200);
    const popular = menu.body.find((i: any) => i.id === popularItem.body.id);
    const unpopular = menu.body.find((i: any) => i.id === unpopularItem.body.id);
    expect(popular.isBestseller).toBe(true);
    expect(unpopular.isBestseller).toBe(false);
  });
});
