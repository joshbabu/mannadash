import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, markOrderAsPaid, signUpCustomer, signUpRestaurant } from './test-helpers';

/**
 * GET /orders/:id/tax-invoice — the backend-owned data behind the "Tax Invoice (preview)"
 * button (see taxInvoiceDraft.js / TrackOrderScreen on the frontend). Three things this
 * spec exists to prove:
 *   1. The invoice number is assigned exactly once and never changes on re-fetch —
 *      real GST invoices must be immutable once issued.
 *   2. A restaurant's real GSTIN/FSSAI (if that restaurant has completed KYC for them)
 *      passes through untouched — this endpoint must never overwrite real data with
 *      placeholder/test values.
 *   3. The platform's own registration profile defaults to obviously-fake TEST values
 *      (never silently real-looking) until PLATFORM_GSTIN is actually configured.
 */
describe('Order tax invoice data (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(() => {
    delete process.env.PLATFORM_GSTIN;
    delete process.env.PLATFORM_PAN;
    delete process.env.PLATFORM_CIN;
    delete process.env.PLATFORM_LEGAL_NAME;
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupPaidOrder(restaurantOverrides: Record<string, any> = {}) {
    const restaurant = await signUpRestaurant(app, restaurantOverrides);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    const item = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Invoice Test Dish', price: 200, category: 'main' })
      .expect(201);

    const customer = await signUpCustomer(app);
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: item.body.id, quantity: 1 }],
        deliveryAddress: 'Invoice Test Address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);

    await markOrderAsPaid(app, order.body.id);
    return { restaurant, customer, orderId: order.body.id };
  }

  it('generates an invoice number on first request and never changes it on re-fetch', async () => {
    const { customer, orderId } = await setupPaidOrder();

    const first = await request(app.getHttpServer())
      .get(`/orders/${orderId}/tax-invoice`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(first.body.invoiceNumber).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get(`/orders/${orderId}/tax-invoice`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(second.body.invoiceNumber).toBe(first.body.invoiceNumber);
  });

  it("passes through a restaurant's real GSTIN/FSSAI when it has completed KYC for them", async () => {
    const { customer, orderId } = await setupPaidOrder({ gstin: '36ABCDE1234F1Z5', fssaiNumber: '12345678901234' });

    const res = await request(app.getHttpServer())
      .get(`/orders/${orderId}/tax-invoice`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body.restaurantGstin).toBe('36ABCDE1234F1Z5');
    expect(res.body.restaurantFssai).toBe('12345678901234');
  });

  it('reports null (not a fabricated value) when a restaurant has no GSTIN/FSSAI on file', async () => {
    const { customer, orderId } = await setupPaidOrder();

    const res = await request(app.getHttpServer())
      .get(`/orders/${orderId}/tax-invoice`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body.restaurantGstin).toBeNull();
    expect(res.body.restaurantFssai).toBeNull();
  });

  it('defaults the platform tax profile to obviously-fake TEST values, never a real-looking default', async () => {
    const { customer, orderId } = await setupPaidOrder();

    const res = await request(app.getHttpServer())
      .get(`/orders/${orderId}/tax-invoice`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body.platform.isTestData).toBe(true);
    expect(res.body.platform.gstin).toContain('TEST');
    expect(res.body.platform.pan).toContain('TEST');
  });

  it('flips isTestData to false and uses real values once PLATFORM_GSTIN is actually configured', async () => {
    process.env.PLATFORM_GSTIN = '36REALGSTIN001Z1';
    process.env.PLATFORM_PAN = 'REALPAN0001R';
    process.env.PLATFORM_LEGAL_NAME = 'Real Legal Entity Pvt Ltd';

    const { customer, orderId } = await setupPaidOrder();
    const res = await request(app.getHttpServer())
      .get(`/orders/${orderId}/tax-invoice`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body.platform.isTestData).toBe(false);
    expect(res.body.platform.gstin).toBe('36REALGSTIN001Z1');
    expect(res.body.platform.legalEntityName).toBe('Real Legal Entity Pvt Ltd');
  });

  it('refuses to generate an invoice for an order that has not been paid yet', async () => {
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
      .send({ restaurantId: restaurant.id, name: 'Unpaid Dish', price: 150, category: 'main' })
      .expect(201);
    const customer = await signUpCustomer(app);
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: item.body.id, quantity: 1 }],
        deliveryAddress: 'Unpaid Test Address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/orders/${order.body.id}/tax-invoice`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(400);
  });

  it("one customer cannot fetch another customer's tax invoice", async () => {
    const { orderId } = await setupPaidOrder();
    const otherCustomer = await signUpCustomer(app);

    await request(app.getHttpServer())
      .get(`/orders/${orderId}/tax-invoice`)
      .set('Authorization', `Bearer ${otherCustomer.token}`)
      .expect(403);
  });

  it('requires authentication', async () => {
    const { orderId } = await setupPaidOrder();
    await request(app.getHttpServer()).get(`/orders/${orderId}/tax-invoice`).expect(401);
  });
});
