import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';

/**
 * The Online/Offline toggle (isOpen) — a manual override, independent of operating hours,
 * for "busy kitchen, stop taking orders NOW". The backend flag existed since the beginning;
 * Phase 3 put a switch on it, so its behavior contract gets pinned down here:
 *  - offline blocks new orders immediately
 *  - offline hides the restaurant from customer "nearby" discovery
 *  - only the owner can flip their own toggle
 *  - going back online restores everything
 */
describe('Restaurant online/offline toggle (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function approvedRestaurant() {
    const restaurant = await signUpRestaurant(app);
    const adminToken = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' })
      .expect(200);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Toggle Test Dish', price: 100, category: 'main' })
      .expect(201);
    return { restaurant, menuItemId: menuItem.body.id };
  }

  function setOpen(restaurant: any, isOpen: boolean) {
    return request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ isOpen });
  }

  async function placeOrder(restaurantId: string, menuItemId: string) {
    const customer = await signUpCustomer(app);
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryAddress: 'Toggle Test Address',
        latitude: 17.45,
        longitude: 78.39,
      });
  }

  it('blocks new orders while offline and accepts them again after going back online', async () => {
    const { restaurant, menuItemId } = await approvedRestaurant();

    await setOpen(restaurant, false).expect(200);
    const blocked = await placeOrder(restaurant.id, menuItemId);
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain('not currently accepting orders');

    await setOpen(restaurant, true).expect(200);
    const accepted = await placeOrder(restaurant.id, menuItemId);
    expect(accepted.status).toBe(201);
  });

  it('hides an offline restaurant from customer nearby discovery', async () => {
    const { restaurant } = await approvedRestaurant();

    // Test restaurants register at Hyderabad center (17.44, 78.38) — search right there
    const nearbyWhileOnline = await request(app.getHttpServer())
      .get('/restaurants/nearby?lat=17.44&lng=78.38')
      .expect(200);
    expect(nearbyWhileOnline.body.some((r: any) => r.id === restaurant.id)).toBe(true);

    await setOpen(restaurant, false).expect(200);
    const nearbyWhileOffline = await request(app.getHttpServer())
      .get('/restaurants/nearby?lat=17.44&lng=78.38')
      .expect(200);
    expect(nearbyWhileOffline.body.some((r: any) => r.id === restaurant.id)).toBe(false);
  });

  it('reflects the current value in the public restaurant record (what the dashboard toggle reads)', async () => {
    const { restaurant } = await approvedRestaurant();
    await setOpen(restaurant, false).expect(200);
    const res = await request(app.getHttpServer()).get(`/restaurants/${restaurant.id}`).expect(200);
    expect(res.body.isOpen).toBe(false);
  });

  it("forbids toggling someone else's restaurant", async () => {
    const { restaurant } = await approvedRestaurant();
    const { restaurant: other } = await approvedRestaurant();
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ isOpen: false })
      .expect(403);
  });
});
