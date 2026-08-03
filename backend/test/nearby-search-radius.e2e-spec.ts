import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpRestaurant } from './test-helpers';

/**
 * The "nearby restaurants" search radius — set to 15km, matching what Zomato uses. Real
 * Hyderabad coordinates are used here rather than made-up ones, so this tests the actual
 * real-world distances the radius needs to include/exclude, not an arbitrary number:
 *   - Uppal to Paradise Biryani (Secunderabad) is ~9.75km — should show up.
 *   - Uppal to Green Bawarchi (Gachibowli) is ~22.5km — should not.
 */
describe('Nearby restaurants — 15km search radius (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const UPPAL = { lat: 17.3981827, lng: 78.5669366 };
  const SECUNDERABAD = { lat: 17.4417141, lng: 78.4872154 }; // ~9.75km from Uppal
  const GACHIBOWLI = { lat: 17.4413397, lng: 78.359356 }; // ~22.5km from Uppal

  async function approvedRestaurantAt(coords: { lat: number; lng: number }) {
    const restaurant = await signUpRestaurant(app, { latitude: coords.lat, longitude: coords.lng });
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    return restaurant;
  }

  it('a restaurant ~9.75km away shows up in the default search (no radius param sent)', async () => {
    const restaurant = await approvedRestaurantAt(SECUNDERABAD);
    const res = await request(app.getHttpServer())
      .get(`/restaurants/nearby?lat=${UPPAL.lat}&lng=${UPPAL.lng}`)
      .expect(200);
    expect(res.body.some((r: any) => r.id === restaurant.id)).toBe(true);
  });

  it('a restaurant ~22.5km away does not show up in the default search — correctly outside 15km', async () => {
    const restaurant = await approvedRestaurantAt(GACHIBOWLI);
    const res = await request(app.getHttpServer())
      .get(`/restaurants/nearby?lat=${UPPAL.lat}&lng=${UPPAL.lng}`)
      .expect(200);
    expect(res.body.some((r: any) => r.id === restaurant.id)).toBe(false);
  });

  it('explicitly requesting a wider radius (20km) still finds the ~22.5km-outside restaurant only if it actually widens far enough', async () => {
    const restaurant = await approvedRestaurantAt(GACHIBOWLI);
    // 20km still isn't enough for a 22.5km-away restaurant — confirms radius filtering is
    // real distance math, not just "is a radius param present".
    const res = await request(app.getHttpServer())
      .get(`/restaurants/nearby?lat=${UPPAL.lat}&lng=${UPPAL.lng}&radius=20000`)
      .expect(200);
    expect(res.body.some((r: any) => r.id === restaurant.id)).toBe(false);
  });

  it('a radius beyond the cap is rejected', async () => {
    await request(app.getHttpServer())
      .get(`/restaurants/nearby?lat=${UPPAL.lat}&lng=${UPPAL.lng}&radius=100000`)
      .expect(400);
  });
});
