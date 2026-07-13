import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpRestaurant } from './test-helpers';

/**
 * Phase H: find restaurants BY DISH, not just by name/cuisine. Extends the existing
 * findNearby (geo search) with an optional `dish` param rather than a separate endpoint,
 * so dish search still respects the same geographic/open/approved constraints — a
 * hyperlocal delivery app has no use for "restaurants 50km away that serve biryani".
 */
describe('Dish-level search (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApprovedRestaurantWithDish(dishName: string, latitude = 17.45, longitude = 78.39) {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ latitude, longitude })
      .expect(200);
    await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: dishName, price: 150, category: 'main' })
      .expect(201);
    return restaurant;
  }

  it('finds a restaurant by dish name, case-insensitively, even when the restaurant name never mentions it', async () => {
    const restaurant = await setupApprovedRestaurantWithDish('Litti Chokha');
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'LITTI' })
      .expect(200);
    expect(res.body.some((r: any) => r.id === restaurant.id)).toBe(true);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.matchedDishes).toContain('Litti Chokha');
  });

  it('matches a partial dish name, not just an exact one', async () => {
    const restaurant = await setupApprovedRestaurantWithDish('Gongura Mutton Biryani');
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'gongura' })
      .expect(200);
    expect(res.body.some((r: any) => r.id === restaurant.id)).toBe(true);
  });

  it('returns an empty list, not every restaurant, when no one serves the searched dish', async () => {
    await setupApprovedRestaurantWithDish('Litti Chokha');
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'this-dish-does-not-exist-anywhere' })
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('excludes a restaurant whose matching dish is currently sold out', async () => {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ latitude: 17.45, longitude: 78.39 })
      .expect(200);
    const item = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Sold Out Dish', price: 150, category: 'main' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/menu-items/${item.body.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ isAvailable: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'sold out' })
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('does not surface a matching restaurant outside the search radius', async () => {
    // Unique dish name — earlier tests in this file also create "litti"-matching
    // restaurants within the default radius, and tests share one DB without resetting
    // between each other, so a generic query here would incidentally match those too.
    await setupApprovedRestaurantWithDish('Faraway Exclusive Zorbaqui Dish', 17.75, 78.69);
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'zorbaqui', radius: 5000 })
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('excludes a closed restaurant even if it has the matching dish', async () => {
    const restaurant = await setupApprovedRestaurantWithDish('Closed Restaurant Litti Chokha');
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ isOpen: false })
      .expect(200);
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'litti' })
      .expect(200);
    expect(res.body.some((r: any) => r.id === restaurant.id)).toBe(false);
  });

  it('does not include matchedDishes at all when no dish search was performed — unchanged behavior', async () => {
    await setupApprovedRestaurantWithDish('Plain Search Test Dish');
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39 })
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).not.toHaveProperty('matchedDishes');
  });

  it('a restaurant with multiple matching dishes lists all of them', async () => {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ latitude: 17.45, longitude: 78.39 })
      .expect(200);
    await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Chicken Biryani', price: 200, category: 'main' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Mutton Biryani', price: 250, category: 'main' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'biryani' })
      .expect(200);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.matchedDishes).toHaveLength(2);
    expect(match.matchedDishes).toEqual(expect.arrayContaining(['Chicken Biryani', 'Mutton Biryani']));
  });

  it('matches "Icecream" (one word) against a search for "Ice Cream" (with a space) — a real production bug', async () => {
    // Real-world find: the customer added "Gulab Jamun with Icecream" — the "Ice Cream"
    // category button searches with a space (the natural way to read the button label),
    // but a plain substring match would never find "Icecream" inside that dish name.
    // Spaces are normalized out of both sides before comparing, fixing this and the whole
    // class of inconsistently-spaced compound food words (Butter Milk/Buttermilk, etc).
    const restaurant = await setupApprovedRestaurantWithDish('Gulab Jamun with Icecream');
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'Ice Cream' })
      .expect(200);
    expect(res.body.some((r: any) => r.id === restaurant.id)).toBe(true);
    const match = res.body.find((r: any) => r.id === restaurant.id);
    expect(match.matchedDishes).toContain('Gulab Jamun with Icecream');
  });

  it('still matches normally when spacing is already consistent on both sides', async () => {
    const restaurant = await setupApprovedRestaurantWithDish('Vanilla Ice Cream');
    const res = await request(app.getHttpServer())
      .get('/restaurants/nearby')
      .query({ lat: 17.45, lng: 78.39, dish: 'Ice Cream' })
      .expect(200);
    expect(res.body.some((r: any) => r.id === restaurant.id)).toBe(true);
  });
});
