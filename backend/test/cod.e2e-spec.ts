import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';

/**
 * Cash on Delivery — the payment method that needs no gateway, making real paid orders
 * possible before Razorpay is unblocked. The contract:
 *  - customers choose 'cod' at order time (omitted = 'online', preserving old behavior)
 *  - a COD order stays payment-pending through the whole kitchen/delivery flow
 *  - the rider handing it over (status -> delivered) IS the payment moment: flips to paid
 *  - online orders are untouched by delivery — they stay pending until a gateway payment
 *  - cancelling an unpaid COD order flags NO refund (no money ever moved)
 *  - the Razorpay create-payment path refuses COD orders outright
 */
describe('Cash on delivery (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Full real setup: approved restaurant, verified+available rider, one menu item. */
  async function setup() {
    const restaurant = await signUpRestaurant(app);
    const rider = await signUpRider(app);
    const customer = await signUpCustomer(app);
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
      .send({ restaurantId: restaurant.id, name: 'COD Test Dish', price: 100, category: 'main' })
      .expect(201);

    return { restaurant, rider, customer, menuItemId: menuItem.body.id };
  }

  function placeOrder(ctx: any, paymentMethod?: string) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({
        restaurantId: ctx.restaurant.id,
        items: [{ menuItemId: ctx.menuItemId, quantity: 1 }],
        deliveryAddress: 'COD Test Address',
        latitude: 17.45,
        longitude: 78.39,
        ...(paymentMethod ? { paymentMethod } : {}),
      });
  }

  /** Drives an order through the full real lifecycle to delivered, with correct role tokens. */
  async function deliverOrder(ctx: any, orderId: string) {
    const t = (token: string, status: string) =>
      request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status })
        .expect(200);
    await t(ctx.restaurant.token, 'accepted');
    await t(ctx.restaurant.token, 'preparing');
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/assign-rider/${ctx.rider.id}`)
      .set('Authorization', `Bearer ${ctx.restaurant.token}`)
      .expect(201);
    await t(ctx.restaurant.token, 'ready_for_pickup');
    await t(ctx.rider.token, 'picked_up');
    await t(ctx.rider.token, 'delivered');
  }

  it('persists the chosen method, defaults to online when omitted, rejects junk', async () => {
    const ctx = await setup();

    const cod = await placeOrder(ctx, 'cod').expect(201);
    expect(cod.body.paymentMethod).toBe('cod');
    expect(cod.body.paymentStatus).toBe('pending');

    const online = await placeOrder(ctx).expect(201);
    expect(online.body.paymentMethod).toBe('online');

    await placeOrder(ctx, 'crypto').expect(400);
  });

  it('flips a COD order to paid at the moment of delivery', async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx, 'cod').expect(201);
    await deliverOrder(ctx, order.body.id);

    const after = await request(app.getHttpServer())
      .get(`/orders/${order.body.id}`)
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(200);
    expect(after.body.status).toBe('delivered');
    expect(after.body.paymentStatus).toBe('paid');
  });

  it('leaves an online order pending after delivery — the gateway, not the rider, collects it', async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx, 'online').expect(201);
    await deliverOrder(ctx, order.body.id);

    const after = await request(app.getHttpServer())
      .get(`/orders/${order.body.id}`)
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(200);
    expect(after.body.paymentStatus).toBe('pending');
  });

  it('flags no refund when an unpaid COD order is cancelled — no money ever moved', async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx, 'cod').expect(201);
    await request(app.getHttpServer())
      .patch(`/orders/${order.body.id}/status`)
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .send({ status: 'cancelled' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/orders/${order.body.id}`)
      .set('Authorization', `Bearer ${ctx.customer.token}`)
      .expect(200);
    expect(after.body.refundStatus).toBe('none');
  });

  it('refuses to start an online payment for a COD order', async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx, 'cod').expect(201);
    const res = await request(app.getHttpServer())
      .post(`/orders/${order.body.id}/create-payment`)
      .set('Authorization', `Bearer ${ctx.customer.token}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('cash-on-delivery');
  });
});
