import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, signUpRestaurant } from './test-helpers';

describe('Menu item image upload (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a realistically-sized base64 photo without hitting the body size limit', async () => {
    const restaurant = await signUpRestaurant(app);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Photo Test Item', price: 100, category: 'main' })
      .expect(201);

    // ~200KB of base64 data — comfortably larger than Express's default 100kb body limit
    // (this is exactly the bug: a real photo this size used to get rejected with 413 before
    // ever reaching our own code)
    const fakeImageData = 'A'.repeat(200_000);
    const imageBase64 = `data:image/jpeg;base64,${fakeImageData}`;

    const res = await request(app.getHttpServer())
      .post(`/menu-items/${menuItem.body.id}/image`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ imageBase64 });

    // We don't have real R2 credentials in this test environment, so the upload itself will be
    // rejected — but the important thing is it's rejected by OUR code (400, a real business
    // error) rather than by Express's body parser (413) before ever reaching our controller.
    expect(res.status).not.toBe(413);
  });
});
