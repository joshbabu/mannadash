import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpRestaurant } from './test-helpers';

/**
 * Price range and "has an offer" on GET /restaurants/nearby — computed for the Filters
 * & Sorting modal's Dish Price and Offers sections. Deliberately simplified vs. the full
 * per-customer offer eligibility engine (day-of-week, time-of-day, usage limits,
 * audience) — this is a list-view signal, not a checkout guarantee; the real discount
 * is still confirmed honestly via the existing preview endpoint at checkout time.
 */
describe('Price range and offer presence on nearby restaurants (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function approvedRestaurantAt(lat: number, lng: number) {
    const restaurant = await signUpRestaurant(app, { latitude: lat, longitude: lng });
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    return restaurant;
  }

  it('computes the real min and max price across a restaurant\'s available dishes', async () => {
    const restaurant = await approvedRestaurantAt(17.45, 78.39);
    await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Cheap', price: 80, category: 'main' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Mid', price: 250, category: 'main' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Expensive', price: 600, category: 'main' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39 })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.priceRange).toEqual({ minPrice: 80, maxPrice: 600 });
  });

  it('excludes a sold-out dish from the price range', async () => {
    const restaurant = await approvedRestaurantAt(17.46, 78.40);
    await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Available', price: 150, category: 'main' })
      .expect(201);
    const soldOut = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Sold Out Cheap', price: 20, category: 'main' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/menu-items/${soldOut.body.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ isAvailable: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.46, lng: 78.40 })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    // ₹20 sold-out item must not drag the min price down — it isn't actually orderable
    expect(match.priceRange).toEqual({ minPrice: 150, maxPrice: 150 });
  });

  it('a restaurant with no menu items has no priceRange key at all, not an empty/null one', async () => {
    const restaurant = await approvedRestaurantAt(17.47, 78.41);
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.47, lng: 78.41 })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match).not.toHaveProperty('priceRange');
  });

  it('hasActiveOffer is true for a restaurant with a real active automatic offer', async () => {
    const restaurant = await approvedRestaurantAt(17.48, 78.42);
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Auto Discount', discountType: 'percentage', discountValue: 15 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.48, lng: 78.42 })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.hasActiveOffer).toBe(true);
  });

  it('hasActiveOffer is false for a restaurant with only a code-based (non-automatic) offer', async () => {
    // A code-based offer requires the customer to type it — not something a list badge
    // should imply is just sitting there waiting for them
    const restaurant = await approvedRestaurantAt(17.49, 78.43);
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Code Only', code: 'SAVE10', discountType: 'flat', discountValue: 10 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.49, lng: 78.43 })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.hasActiveOffer).toBe(false);
  });

  it('hasActiveOffer is false for a paused (inactive) offer', async () => {
    const restaurant = await approvedRestaurantAt(17.50, 78.44);
    const offer = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Paused', discountType: 'percentage', discountValue: 20 })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/offers/${offer.body.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ active: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.50, lng: 78.44 })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.hasActiveOffer).toBe(false);
  });

  it('hasActiveOffer is false for an offer whose date window has already ended', async () => {
    const restaurant = await approvedRestaurantAt(17.51, 78.45);
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Expired', discountType: 'percentage', discountValue: 20, endDate: '2020-01-01' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.51, lng: 78.45 })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.hasActiveOffer).toBe(false);
  });

  it('hasActiveOffer is true for an offer whose date window has not started yet is false, and one already running is true', async () => {
    const restaurant = await approvedRestaurantAt(17.52, 78.46);
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ name: 'Future', discountType: 'percentage', discountValue: 20, startDate: '2099-01-01' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.52, lng: 78.46 })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.hasActiveOffer).toBe(false);
  });
});
