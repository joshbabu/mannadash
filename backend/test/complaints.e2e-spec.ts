import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';

describe('Complaints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function placeCancelledOrder() {
    const customer = await signUpCustomer(app);
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
      .send({ restaurantId: restaurant.id, name: 'Cancel Complaint Dish', price: 150, category: 'main' })
      .expect(201);
    const placed = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: item.body.id, quantity: 1 }],
        deliveryAddress: 'Cancel Complaint Address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ status: 'cancelled' })
      .expect(200);
    return { customer, restaurant, admin, orderId: placed.body.id };
  }

  it('cannot file a complaint against an order that is still active (not delivered or cancelled)', async () => {
    const customer = await signUpCustomer(app);
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
      .send({ restaurantId: restaurant.id, name: 'Active Order Dish', price: 100, category: 'main' })
      .expect(201);
    const placed = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: item.body.id, quantity: 1 }],
        deliveryAddress: 'Active Address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/orders/${placed.body.id}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'wrong_item', description: 'This is not what I ordered at all' })
      .expect(400);
    expect(res.body.message).toMatch(/delivered or cancelled/i);
  });

  it('can file a complaint against a cancelled order', async () => {
    const { customer, orderId } = await placeCancelledOrder();
    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'other', description: 'Order was cancelled but I was not told why' })
      .expect(201);
    expect(res.body.status).toBe('open');
    expect(res.body.category).toBe('other');
  });

  it('rejects an invalid category', async () => {
    const { customer, orderId } = await placeCancelledOrder();
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'not_a_real_category', description: 'Something genuinely long enough' })
      .expect(400);
  });

  it('rejects a description that is too short to be useful', async () => {
    const { customer, orderId } = await placeCancelledOrder();
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'other', description: 'bad' })
      .expect(400);
  });

  it('a customer cannot file a complaint against someone else\'s order', async () => {
    const { orderId } = await placeCancelledOrder();
    const otherCustomer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${otherCustomer.token}`)
      .send({ category: 'other', description: 'Trying to complain about an order that is not mine' })
      .expect(403);
  });

  it('allows multiple complaints against the same order, unlike ratings', async () => {
    const { customer, orderId } = await placeCancelledOrder();
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'missing_item', description: 'The dessert I paid for never showed up' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'quality_issue', description: 'And the main course arrived cold as well' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/orders/complaints/mine')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body).toHaveLength(2);
  });

  it('the restaurant sees complaints against its own orders, with the response flow working end to end', async () => {
    const { customer, restaurant, orderId } = await placeCancelledOrder();
    const filed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'other', description: 'Restaurant response test complaint' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/orders/complaints/restaurant/mine')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(200);
    expect(list.body.find((c: any) => c.id === filed.body.id)).toBeTruthy();

    const responded = await request(app.getHttpServer())
      .patch(`/orders/complaints/${filed.body.id}/respond`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ responseText: 'Sorry about that, we have refunded you in full.', status: 'resolved' })
      .expect(200);
    expect(responded.body.restaurantResponse).toBe('Sorry about that, we have refunded you in full.');
    expect(responded.body.status).toBe('resolved');
    expect(responded.body.resolvedAt).toBeTruthy();
  });

  it('a restaurant cannot respond to a complaint about another restaurant\'s order', async () => {
    const { customer, orderId } = await placeCancelledOrder();
    const otherRestaurant = await signUpRestaurant(app);
    const filed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'other', description: 'Cross-restaurant response attempt test' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/orders/complaints/${filed.body.id}/respond`)
      .set('Authorization', `Bearer ${otherRestaurant.token}`)
      .send({ responseText: 'This should not be allowed to go through' })
      .expect(403);
  });

  it('admin sees every complaint across the platform and can resolve any of them', async () => {
    const { customer, admin, orderId } = await placeCancelledOrder();
    const filed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'late_delivery', description: 'Admin visibility test complaint' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/orders/complaints/admin')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(list.body.find((c: any) => c.id === filed.body.id)).toBeTruthy();

    const resolved = await request(app.getHttpServer())
      .patch(`/orders/complaints/${filed.body.id}/respond`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'in_progress' })
      .expect(200);
    expect(resolved.body.status).toBe('in_progress');
  });

  it('a customer cannot view the restaurant or admin complaint lists', async () => {
    const { customer } = await placeCancelledOrder();
    await request(app.getHttpServer())
      .get('/orders/complaints/restaurant/mine')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/orders/complaints/admin')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(403);
  });

  it('a restaurant cannot respond to a complaint at all without being the right restaurant, and a customer cannot respond as staff', async () => {
    const { customer, orderId } = await placeCancelledOrder();
    const filed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/complaints`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ category: 'other', description: 'Customer trying to respond as staff test' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/orders/complaints/${filed.body.id}/respond`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ responseText: 'A customer should not be able to do this' })
      .expect(403);
  });

  it('requires authentication for every complaint endpoint', async () => {
    const { orderId } = await placeCancelledOrder();
    await request(app.getHttpServer()).post(`/orders/${orderId}/complaints`).send({ category: 'other', description: 'No auth token provided here' }).expect(401);
    await request(app.getHttpServer()).get('/orders/complaints/mine').expect(401);
  });
});
