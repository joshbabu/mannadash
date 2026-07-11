import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';
import { Offer } from '../src/offers/entities/offer.entity';
import { Order, OrderStatus } from '../src/orders/entities/order.entity';

/**
 * Phase L1: the offers/coupons engine. Two very different modes on one entity — automatic
 * (code null, applies itself silently, best-of-several wins) and code-based (customer
 * types it, always takes precedence, invalid/ineligible codes throw rather than silently
 * doing nothing) — plus a real eligibility ruleset: minimum order, first-order-only
 * audience, day/time windows, and per-customer/total usage limits backed by an actual
 * redemption ledger rather than a counter column that could drift.
 */
describe('Offers engine (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApprovedRestaurantWithDish(price = 200) {
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
      .send({ restaurantId: restaurant.id, name: 'Offer Test Dish', price, category: 'main' })
      .expect(201);
    return { restaurant, menuItemId: item.body.id };
  }

  function createOffer(restaurant: any, body: Record<string, any>) {
    return request(app.getHttpServer()).post('/offers').set('Authorization', `Bearer ${restaurant.token}`).send(body);
  }

  function placeOrder(restaurantId: string, customer: any, menuItemId: string, extra: Record<string, any> = {}) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryAddress: 'Offer Test Address',
        latitude: 17.45,
        longitude: 78.39,
        ...extra,
      });
  }

  describe('creating and managing offers (restaurant-owner-guarded)', () => {
    it('creates a percentage offer, and rejects a non-owner from editing or deleting it', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish();
      const res = await createOffer(restaurant, { name: 'Weekend 20%', discountType: 'percentage', discountValue: 20 }).expect(201);
      expect(res.body.discountType).toBe('percentage');

      const other = await setupApprovedRestaurantWithDish();
      await request(app.getHttpServer())
        .patch(`/offers/${res.body.id}`)
        .set('Authorization', `Bearer ${other.restaurant.token}`)
        .send({ name: 'Hacked' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/offers/${res.body.id}`)
        .set('Authorization', `Bearer ${other.restaurant.token}`)
        .expect(403);
    });

    it('rejects a percentage offer with no value, or over 100%', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish();
      await createOffer(restaurant, { name: 'Bad', discountType: 'percentage' }).expect(400);
      await createOffer(restaurant, { name: 'Bad', discountType: 'percentage', discountValue: 150 }).expect(400);
    });

    it('rejects a duplicate code on the same restaurant, but allows the same code across different restaurants', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish();
      await createOffer(restaurant, { name: 'A', code: 'SAVE10', discountType: 'flat', discountValue: 10 }).expect(201);
      await createOffer(restaurant, { name: 'B', code: 'save10', discountType: 'flat', discountValue: 20 }).expect(400); // case-insensitive clash

      const other = await setupApprovedRestaurantWithDish();
      await createOffer(other.restaurant, { name: 'C', code: 'SAVE10', discountType: 'flat', discountValue: 15 }).expect(201);
    });

    it('lists only the owner\'s own offers, and a customer cannot create one', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish();
      const other = await setupApprovedRestaurantWithDish();
      await createOffer(restaurant, { name: 'Mine', discountType: 'flat', discountValue: 10 }).expect(201);
      await createOffer(other.restaurant, { name: 'Theirs', discountType: 'flat', discountValue: 10 }).expect(201);

      const mine = await request(app.getHttpServer()).get('/offers/mine').set('Authorization', `Bearer ${restaurant.token}`).expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].name).toBe('Mine');

      const customer = await signUpCustomer(app);
      await createOffer({ token: customer.token }, { name: 'X', discountType: 'flat', discountValue: 10 }).expect(403);
    });
  });

  describe('automatic offers (no code)', () => {
    it('applies itself silently and computes the discount correctly', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      await createOffer(restaurant, { name: 'Auto 20%', discountType: 'percentage', discountValue: 20 }).expect(201);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(Number(order.body.discountAmount)).toBe(40); // 20% of 200
      expect(order.body.appliedOfferName).toBe('Auto 20%');
      expect(Number(order.body.total)).toBe(Number(order.body.subtotal) + Number(order.body.deliveryFee) - 40);
    });

    it('caps a percentage discount at maxDiscountAmount', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(1000);
      await createOffer(restaurant, { name: 'Capped', discountType: 'percentage', discountValue: 50, maxDiscountAmount: 100 }).expect(201);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(Number(order.body.discountAmount)).toBe(100); // 50% of 1000 = 500, capped at 100
    });

    it('picks the bigger discount when multiple automatic offers are eligible', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      await createOffer(restaurant, { name: 'Small', discountType: 'flat', discountValue: 10 }).expect(201);
      await createOffer(restaurant, { name: 'Big', discountType: 'flat', discountValue: 30 }).expect(201);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(order.body.appliedOfferName).toBe('Big');
      expect(Number(order.body.discountAmount)).toBe(30);
    });

    it('free_delivery discounts exactly the delivery fee, never more', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      await createOffer(restaurant, { name: 'Free delivery', discountType: 'free_delivery' }).expect(201);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(Number(order.body.discountAmount)).toBe(Number(order.body.deliveryFee));
      expect(Number(order.body.total)).toBe(Number(order.body.subtotal));
    });

    it('does not apply below the minimum order value', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(100);
      await createOffer(restaurant, { name: 'Big order only', discountType: 'flat', discountValue: 50, minOrderValue: 500 }).expect(201);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(order.body.appliedOfferName).toBeNull();
      expect(order.body.discountAmount).toBeNull();
    });

    it('an inactive offer never applies', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      const created = await createOffer(restaurant, { name: 'Paused', discountType: 'flat', discountValue: 50 }).expect(201);
      await request(app.getHttpServer())
        .patch(`/offers/${created.body.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ active: false })
        .expect(200);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(order.body.appliedOfferName).toBeNull();
    });

    it('a day-of-week restricted offer only applies on its day', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      const notToday = new Date();
      notToday.setDate(notToday.getDate() + 3); // some other day of the week
      const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      await createOffer(restaurant, {
        name: 'Wrong day',
        discountType: 'flat',
        discountValue: 50,
        daysOfWeek: [DAY_NAMES[notToday.getDay()]],
      }).expect(201);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(order.body.appliedOfferName).toBeNull();
    });
  });

  describe('code-based offers', () => {
    it('a valid code takes precedence over a better automatic offer', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      await createOffer(restaurant, { name: 'Auto Big', discountType: 'flat', discountValue: 40 }).expect(201);
      await createOffer(restaurant, { name: 'Code Small', code: 'HELLO', discountType: 'flat', discountValue: 10 }).expect(201);
      const customer = await signUpCustomer(app);
      // The code offer is worth LESS, but wins anyway because the customer explicitly typed it
      const order = await placeOrder(restaurant.id, customer, menuItemId, { promoCode: 'hello' }).expect(201);
      expect(order.body.appliedOfferName).toBe('Code Small');
      expect(Number(order.body.discountAmount)).toBe(10);
    });

    it('rejects an unknown code with a clear error, not silence', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      const customer = await signUpCustomer(app);
      const res = await placeOrder(restaurant.id, customer, menuItemId, { promoCode: 'NOPE' }).expect(400);
      expect(res.body.message).toContain('not valid');
    });

    it('rejects a real but ineligible code with the specific reason, not a generic error', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(100);
      await createOffer(restaurant, { name: 'Big spend', code: 'BIGSPEND', discountType: 'flat', discountValue: 50, minOrderValue: 500 }).expect(201);
      const customer = await signUpCustomer(app);
      const res = await placeOrder(restaurant.id, customer, menuItemId, { promoCode: 'BIGSPEND' }).expect(400);
      expect(res.body.message).toContain('minimum order');
    });
  });

  describe('audience: first_order', () => {
    it('applies for a genuine first-time customer, not for a repeat customer', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      await createOffer(restaurant, { name: 'Welcome', discountType: 'flat', discountValue: 50, audience: 'first_order' }).expect(201);
      const customer = await signUpCustomer(app);

      const firstOrder = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(firstOrder.body.appliedOfferName).toBe('Welcome');

      // Mark it delivered directly (bypassing the full rider lifecycle — this test is
      // about audience eligibility, not delivery mechanics)
      await dataSource.getRepository(Order).update({ id: firstOrder.body.id }, { status: OrderStatus.DELIVERED });

      const secondOrder = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(secondOrder.body.appliedOfferName).toBeNull();
    });
  });

  describe('usage limits, backed by the redemption ledger', () => {
    it('enforces usageLimitPerCustomer', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      await createOffer(restaurant, { name: 'Once', code: 'ONCE', discountType: 'flat', discountValue: 20, usageLimitPerCustomer: 1 }).expect(201);
      const customer = await signUpCustomer(app);

      await placeOrder(restaurant.id, customer, menuItemId, { promoCode: 'ONCE' }).expect(201);
      const res = await placeOrder(restaurant.id, customer, menuItemId, { promoCode: 'ONCE' }).expect(400);
      expect(res.body.message).toContain('already used');
    });

    it('enforces totalUsageLimit across different customers', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      await createOffer(restaurant, { name: 'Limited', code: 'LIMITED', discountType: 'flat', discountValue: 20, totalUsageLimit: 1 }).expect(201);
      const customerA = await signUpCustomer(app);
      const customerB = await signUpCustomer(app);

      await placeOrder(restaurant.id, customerA, menuItemId, { promoCode: 'LIMITED' }).expect(201);
      const res = await placeOrder(restaurant.id, customerB, menuItemId, { promoCode: 'LIMITED' }).expect(400);
      expect(res.body.message).toContain('usage limit');
    });

    it('creates exactly one redemption row per successful application', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      const offer = await createOffer(restaurant, { name: 'Tracked', discountType: 'flat', discountValue: 20 }).expect(201);
      const customer = await signUpCustomer(app);
      await placeOrder(restaurant.id, customer, menuItemId).expect(201);

      const redemptions = await dataSource.query('SELECT * FROM offer_redemptions WHERE "offerId" = $1', [offer.body.id]);
      expect(redemptions).toHaveLength(1);
      expect(Number(redemptions[0].discountAmount)).toBe(20);
    });
  });

  describe('public offers listing', () => {
    it('shows automatic offers in full, code offers as a blind teaser (no code leak)', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish();
      await createOffer(restaurant, { name: 'Auto', discountType: 'percentage', discountValue: 15 }).expect(201);
      await createOffer(restaurant, { name: 'Secret', code: 'SECRET123', discountType: 'flat', discountValue: 30 }).expect(201);

      const res = await request(app.getHttpServer()).get(`/restaurants/${restaurant.id}/offers`).expect(200);
      expect(res.body).toHaveLength(2);
      const auto = res.body.find((o: any) => o.name === 'Auto');
      const secret = res.body.find((o: any) => o.name === 'Secret');
      expect(auto.hasCode).toBe(false);
      expect(secret.hasCode).toBe(true);
      expect(secret).not.toHaveProperty('code');
      expect(JSON.stringify(res.body)).not.toContain('SECRET123');
    });

    it('excludes an inactive offer from the public listing', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish();
      const offer = await createOffer(restaurant, { name: 'Paused', discountType: 'flat', discountValue: 10 }).expect(201);
      await request(app.getHttpServer())
        .patch(`/offers/${offer.body.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ active: false })
        .expect(200);
      const res = await request(app.getHttpServer()).get(`/restaurants/${restaurant.id}/offers`).expect(200);
      expect(res.body).toHaveLength(0);
    });
  });

  describe('checkout preview (never throws, gives an honest reason instead)', () => {
    it('previews the best automatic offer without a code', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish(200);
      await createOffer(restaurant, { name: 'Auto 20%', discountType: 'percentage', discountValue: 20 }).expect(201);
      const customer = await signUpCustomer(app);
      const res = await request(app.getHttpServer())
        .post('/offers/preview')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ restaurantId: restaurant.id, subtotal: 200, latitude: 17.45, longitude: 78.39 })
        .expect(201);
      expect(res.body.applied).toBe(true);
      expect(res.body.offerName).toBe('Auto 20%');
      expect(res.body.discountAmount).toBe(40);
      // The real distance-based fee, not a placeholder — this is what lets checkout show
      // an honest total before the order is placed, not "calculated at checkout"
      expect(res.body.deliveryFee).toBeGreaterThan(0);
    });

    it('returns the real delivery fee even when no offer applies at all', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish(200);
      const customer = await signUpCustomer(app);
      const res = await request(app.getHttpServer())
        .post('/offers/preview')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ restaurantId: restaurant.id, subtotal: 200, latitude: 17.45, longitude: 78.39 })
        .expect(201);
      expect(res.body.applied).toBe(false);
      expect(res.body.deliveryFee).toBeGreaterThan(0);
    });

    it('reports a real reason for an ineligible code, with a normal response, not a raw error', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish(100);
      await createOffer(restaurant, { name: 'Big', code: 'BIG', discountType: 'flat', discountValue: 50, minOrderValue: 500 }).expect(201);
      const customer = await signUpCustomer(app);
      const res = await request(app.getHttpServer())
        .post('/offers/preview')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ restaurantId: restaurant.id, subtotal: 100, latitude: 17.45, longitude: 78.39, promoCode: 'BIG' })
        .expect(201);
      expect(res.body.applied).toBe(false);
      expect(res.body.reason).toContain('minimum order');
    });

    it('previews nothing when no offer exists at all', async () => {
      const { restaurant } = await setupApprovedRestaurantWithDish(200);
      const customer = await signUpCustomer(app);
      const res = await request(app.getHttpServer())
        .post('/offers/preview')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ restaurantId: restaurant.id, subtotal: 200, latitude: 17.45, longitude: 78.39 })
        .expect(201);
      expect(res.body.applied).toBe(false);
      expect(res.body.reason).toBeUndefined();
    });
  });
});
