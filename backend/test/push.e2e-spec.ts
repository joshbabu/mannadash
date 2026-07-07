import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, signUpRider } from './test-helpers';

describe('Push notifications (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes the VAPID public key without requiring auth', async () => {
    const res = await request(app.getHttpServer()).get('/push/vapid-public-key').expect(200);
    expect(res.body).toHaveProperty('publicKey');
  });

  it('requires authentication to save a subscription', async () => {
    await request(app.getHttpServer())
      .post('/push/subscribe')
      .send({ subscription: { endpoint: 'https://example.com/fake', keys: { p256dh: 'x', auth: 'y' } } })
      .expect(401);
  });

  it('lets an authenticated rider save a subscription', async () => {
    const rider = await signUpRider(app);
    await request(app.getHttpServer())
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ subscription: { endpoint: 'https://example.com/fake', keys: { p256dh: 'x', auth: 'y' } } })
      .expect(201);
  });
});
