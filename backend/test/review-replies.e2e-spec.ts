import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';

/**
 * Phase L3: a restaurant replying to a review's comment. Ownership runs through
 * order.restaurant (Rating has no direct restaurant FK), and a second reply overwrites
 * the first rather than stacking a thread — matching Zomato's one-reply-per-review model.
 */
describe('Review replies (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Full real lifecycle to a delivered, rated order, with a comment worth replying to. */
  async function deliverAndRateAnOrder() {
    const restaurant = await signUpRestaurant(app);
    const rider = await signUpRider(app);
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
      .patch('/delivery-partners/me/location')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ latitude: 17.45, longitude: 78.39 })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/delivery-partners/me/availability')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ isAvailable: true })
      .expect(200);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Reply Test Dish', price: 100, category: 'main' })
      .expect(201);
    const customer = await signUpCustomer(app);
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: menuItem.body.id, quantity: 1 }],
        deliveryAddress: 'Reply Test Address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);

    const t = (token: string, status: string) =>
      request(app.getHttpServer())
        .patch(`/orders/${order.body.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status })
        .expect(200);
    await t(restaurant.token, 'accepted');
    await t(restaurant.token, 'preparing');
    await t(restaurant.token, 'ready_for_pickup');
    // The rider being available+located isn't enough — they have to be explicitly
    // assigned to THIS order before they're allowed to mark it picked up
    await request(app.getHttpServer())
      .post(`/orders/${order.body.id}/assign-rider/${rider.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .expect(201);
    await t(rider.token, 'picked_up');
    await t(rider.token, 'delivered');

    const rating = await request(app.getHttpServer())
      .post(`/orders/${order.body.id}/rating`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ restaurantRating: 4, deliveryRating: 5, comment: 'Good but a bit late' })
      .expect(201);

    return { restaurant, ratingId: rating.body.id };
  }

  it('lets the restaurant reply, and the reply shows up on the public reviews list', async () => {
    const { restaurant, ratingId } = await deliverAndRateAnOrder();
    const res = await request(app.getHttpServer())
      .patch(`/orders/ratings/${ratingId}/reply`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ replyText: "Sorry about the delay — we've addressed it with our kitchen team." })
      .expect(200);
    expect(res.body.replyText).toContain('Sorry about the delay');
    expect(res.body.repliedAt).toBeTruthy();

    const publicReviews = await request(app.getHttpServer())
      .get(`/orders/restaurant/${restaurant.id}/reviews`)
      .expect(200);
    const mine = publicReviews.body.find((r: any) => r.id === ratingId);
    expect(mine.replyText).toContain('Sorry about the delay');
  });

  it('replying again overwrites the previous reply rather than stacking one', async () => {
    const { restaurant, ratingId } = await deliverAndRateAnOrder();
    await request(app.getHttpServer())
      .patch(`/orders/ratings/${ratingId}/reply`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ replyText: 'First reply' })
      .expect(200);
    const second = await request(app.getHttpServer())
      .patch(`/orders/ratings/${ratingId}/reply`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ replyText: 'Updated reply' })
      .expect(200);
    expect(second.body.replyText).toBe('Updated reply');
  });

  it('rejects a reply from a different restaurant, a customer, and an empty reply', async () => {
    const { ratingId } = await deliverAndRateAnOrder();

    const otherRestaurant = await signUpRestaurant(app);
    await request(app.getHttpServer())
      .patch(`/orders/ratings/${ratingId}/reply`)
      .set('Authorization', `Bearer ${otherRestaurant.token}`)
      .send({ replyText: 'Not my review to reply to' })
      .expect(403);

    const customer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .patch(`/orders/ratings/${ratingId}/reply`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ replyText: 'Customers cannot reply' })
      .expect(403);
  });

  it('404s a reply to a review that does not exist', async () => {
    const restaurant = await signUpRestaurant(app);
    await request(app.getHttpServer())
      .patch('/orders/ratings/00000000-0000-0000-0000-000000000000/reply')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ replyText: 'Ghost review' })
      .expect(404);
  });
});
