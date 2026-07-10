import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';

/**
 * Phase B: password recovery without any external service.
 *  - Admin resets any account by role+phone and receives a temp password to relay
 *    out-of-band (call/WhatsApp) — the support path that exists on every platform.
 *  - Each role changes its own password from its own app; the three roles live in three
 *    different tables, so each endpoint is role-locked to prevent cross-table confusion.
 * When WhatsApp-OTP self-service is added later, all of this remains as the fallback.
 */
describe('Password reset & change (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (path: string, phone: string, password: string) =>
    request(app.getHttpServer()).post(path).send({ phone, password });

  describe('admin-assisted reset', () => {
    it('resets a customer: old password dies, temp password works, admin sees whose account it was', async () => {
      const customer = await signUpCustomer(app, 'Reset Target Customer');
      const adminToken = await adminLogin(app);

      const res = await request(app.getHttpServer())
        .post('/admin/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'customer', phone: customer.phone })
        .expect(201);
      expect(res.body.tempPassword).toMatch(/^[a-zA-Z2-9]{10}$/);
      expect(res.body.name).toBe('Reset Target Customer'); // admin confirms the right account

      await login('/auth/login', customer.phone, 'testpass123').expect(401);
      await login('/auth/login', customer.phone, res.body.tempPassword).expect(201);
    });

    it('resets a restaurant and a rider through their own tables', async () => {
      const restaurant = await signUpRestaurant(app);
      const rider = await signUpRider(app);
      const adminToken = await adminLogin(app);

      const r1 = await request(app.getHttpServer())
        .post('/admin/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'restaurant', phone: restaurant.phone })
        .expect(201);
      await login('/restaurants/login', restaurant.phone, r1.body.tempPassword).expect(201);

      const r2 = await request(app.getHttpServer())
        .post('/admin/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'rider', phone: rider.phone })
        .expect(201);
      await login('/delivery-partners/login', rider.phone, r2.body.tempPassword).expect(201);
    });

    it('404s an unknown phone and 403s non-admins', async () => {
      const adminToken = await adminLogin(app);
      await request(app.getHttpServer())
        .post('/admin/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'customer', phone: '9999999999' })
        .expect(404);

      const customer = await signUpCustomer(app);
      await request(app.getHttpServer())
        .post('/admin/reset-password')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ role: 'customer', phone: customer.phone })
        .expect(403);
    });
  });

  describe('change password (per role)', () => {
    it('customer: wrong current password rejected, correct one rotates the credential', async () => {
      const customer = await signUpCustomer(app);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ currentPassword: 'wrong-guess', newPassword: 'newpass456' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ currentPassword: 'testpass123', newPassword: 'newpass456' })
        .expect(201);

      await login('/auth/login', customer.phone, 'testpass123').expect(401);
      await login('/auth/login', customer.phone, 'newpass456').expect(201);
    });

    it('restaurant and rider endpoints work and are role-locked', async () => {
      const restaurant = await signUpRestaurant(app);
      const rider = await signUpRider(app);

      await request(app.getHttpServer())
        .post('/restaurants/me/change-password')
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ currentPassword: 'testpass123', newPassword: 'newpass456' })
        .expect(201);
      await login('/restaurants/login', restaurant.phone, 'newpass456').expect(201);

      await request(app.getHttpServer())
        .post('/delivery-partners/me/change-password')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ currentPassword: 'testpass123', newPassword: 'newpass456' })
        .expect(201);
      await login('/delivery-partners/login', rider.phone, 'newpass456').expect(201);

      // Cross-role attempts bounce at the door — a customer token in the restaurant
      // endpoint would otherwise probe a different table entirely
      const customer = await signUpCustomer(app);
      await request(app.getHttpServer())
        .post('/restaurants/me/change-password')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ currentPassword: 'testpass123', newPassword: 'newpass456' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ currentPassword: 'newpass456', newPassword: 'another789' })
        .expect(403);
    });

    it('rejects a too-short new password', async () => {
      const customer = await signUpCustomer(app);
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ currentPassword: 'testpass123', newPassword: 'abc' })
        .expect(400);
    });
  });
});
