import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';

/**
 * L4: does a restaurant's discounting actually work? Per-offer performance, plus the real
 * effectiveness question — is average order value genuinely higher on orders that used an
 * offer than ones that didn't. Insights itself had zero test coverage before this (a real,
 * pre-existing gap, out of scope to backfill here) — this covers the new piece specifically.
 */
describe('Discount effectiveness insights (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupRestaurantAndRider() {
    const restaurant = await signUpRestaurant(app);
    const rider = await signUpRider(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer()).patch(`/restaurants/${restaurant.id}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'approved' }).expect(200);
    await request(app.getHttpServer()).patch(`/delivery-partners/${rider.id}/verify`).set('Authorization', `Bearer ${admin}`).expect(200);
    const item = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Insights Test Dish', price: 200, category: 'main' })
      .expect(201);
    return { restaurant, rider, menuItemId: item.body.id };
  }

  async function deliverOrder(restaurant: any, rider: any, customer: any, menuItemId: string, extra: Record<string, any> = {}) {
    await request(app.getHttpServer()).patch('/delivery-partners/me/availability').set('Authorization', `Bearer ${rider.token}`).send({ isAvailable: true }).expect(200);
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39, ...extra })
      .expect(201);
    const orderId = order.body.id;
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'accepted' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'preparing' }).expect(200);
    await request(app.getHttpServer()).post(`/orders/${orderId}/assign-rider/${rider.id}`).set('Authorization', `Bearer ${restaurant.token}`).expect(201);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${restaurant.token}`).send({ status: 'ready_for_pickup' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${rider.token}`).send({ status: 'picked_up' }).expect(200);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${rider.token}`).send({ status: 'delivered' }).expect(200);
    return orderId;
  }

  it('a restaurant with no offers at all gets an honest empty structure, not an error', async () => {
    const { restaurant, rider, menuItemId } = await setupRestaurantAndRider();
    const customer = await signUpCustomer(app);
    await deliverOrder(restaurant, rider, customer, menuItemId);

    const res = await request(app.getHttpServer())
      .get('/orders/restaurant/insights')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(200);
    expect(res.body.discountEffectiveness.perOffer).toEqual([]);
    expect(res.body.discountEffectiveness.avgOrderValueWithOffer).toBeNull();
    // One delivered order, no offer on it — this is the "without offer" side of the comparison
    expect(res.body.discountEffectiveness.avgOrderValueWithoutOffer).toBe(200);
    expect(res.body.discountEffectiveness.liftPercent).toBeNull();
  });

  it('tracks real redemption count and discount given per offer', async () => {
    const { restaurant, rider, menuItemId } = await setupRestaurantAndRider();
    const customerA = await signUpCustomer(app);
    const customerB = await signUpCustomer(app);
    const offer = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Insights Test Offer', discountType: 'flat', discountValue: 30 })
      .expect(201);

    await deliverOrder(restaurant, rider, customerA, menuItemId);
    await deliverOrder(restaurant, rider, customerB, menuItemId);

    const res = await request(app.getHttpServer())
      .get('/orders/restaurant/insights')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(200);
    const offerStats = res.body.discountEffectiveness.perOffer.find((o: any) => o.id === offer.body.id);
    expect(offerStats).toBeTruthy();
    expect(offerStats.redemptionCount).toBe(2);
    expect(offerStats.totalDiscountGiven).toBe(60); // ₹30 × 2 redemptions
    expect(offerStats.avgOrderValue).toBe(200); // subtotal before the discount is applied
  });

  it('the with-vs-without comparison uses real, distinct order sets', async () => {
    const { restaurant, rider, menuItemId } = await setupRestaurantAndRider();
    const customerWithOffer = await signUpCustomer(app);
    const customerWithoutOffer = await signUpCustomer(app);
    // Code-based, not automatic — an automatic offer applies itself to every eligible
    // order, which would make both orders "with offer" and defeat the comparison. A code
    // only applies when the customer actually types it, giving genuine control here.
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Comparison Offer', code: 'COMPARE10', discountType: 'flat', discountValue: 10 })
      .expect(201);

    await deliverOrder(restaurant, rider, customerWithOffer, menuItemId, { promoCode: 'COMPARE10' });
    // A second, separate customer's order that never touches the offer at all
    await deliverOrder(restaurant, rider, customerWithoutOffer, menuItemId);

    const res = await request(app.getHttpServer())
      .get('/orders/restaurant/insights')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(200);
    const d = res.body.discountEffectiveness;
    expect(d.ordersWithOffer).toBe(1);
    expect(d.totalOrders).toBe(2);
    expect(d.avgOrderValueWithOffer).toBe(200); // subtotal, before the offer's discount
    expect(d.avgOrderValueWithoutOffer).toBe(200);
    expect(d.liftPercent).toBe(0); // identical AOV either side here — no fake lift invented
  });

  it('cancelled orders never count toward revenue or AOV, even if they redeemed an offer', async () => {
    const { restaurant, rider, menuItemId } = await setupRestaurantAndRider();
    const customer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Cancelled Order Offer', discountType: 'flat', discountValue: 10 })
      .expect(201);

    const placed = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantId: restaurant.id, items: [{ menuItemId, quantity: 1 }], deliveryAddress: 'x', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ status: 'cancelled' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/orders/restaurant/insights')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(200);
    const d = res.body.discountEffectiveness;
    // The redemption itself is real and stays on record (matches how discountAmount
    // survives on the order for receipts), but it contributed zero real revenue
    const offerStats = d.perOffer.find((o: any) => o.name === 'Cancelled Order Offer');
    expect(offerStats.redemptionCount).toBe(1);
    expect(offerStats.revenueFromOffer).toBe(0);
    expect(d.totalOrders).toBe(0); // cancelled orders are excluded from the comparison entirely
  });

  it('one restaurant never sees another restaurant\'s offer performance', async () => {
    const { restaurant, rider, menuItemId } = await setupRestaurantAndRider();
    const other = await setupRestaurantAndRider();
    const customer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${other.restaurant.token}`)
      .send({ name: 'Someone Else\'s Offer', discountType: 'flat', discountValue: 10 })
      .expect(201);
    await deliverOrder(restaurant, rider, customer, menuItemId);

    const res = await request(app.getHttpServer())
      .get('/orders/restaurant/insights')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(200);
    expect(res.body.discountEffectiveness.perOffer.find((o: any) => o.name === 'Someone Else\'s Offer')).toBeUndefined();
  });
});
