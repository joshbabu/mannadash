import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';
import { wallClockParts, RESTAURANT_TIME_ZONE } from '../src/restaurants/operating-hours.util';

/**
 * Onboarding wizard backend: the new restaurant fields (owner contact, per-day hours, KYC
 * documents, bank details, menu basics). The two things that matter most here:
 *  1. PAN and bank details must NEVER appear in any public API response — only via the
 *     admin/owner-guarded /restaurants/:id/kyc endpoint.
 *  2. Per-day hours must actually gate order placement.
 */
describe('Restaurant onboarding (e2e)', () => {
  let app: INestApplication;

  const fullOnboarding = {
    ownerEmail: 'owner@example.com',
    whatsappNumber: '9876543210',
    fssaiNumber: '12345678901234',
    fssaiExpiry: '2027-03-31',
    pan: 'AAMCR7443M',
    gstin: '36AAMCR7443M1ZP',
    legalEntityName: 'MEHFIL RESTAURANT PRIVATE LIMITED',
    bankIfsc: 'HDFC0001234',
    bankAccountNumber: '123456789012',
    isVegOnly: true,
    costForTwo: 400,
    weeklyHours: {
      monday: { open: '09:00', close: '22:00' },
      tuesday: { open: '09:00', close: '22:00' },
      wednesday: { open: '09:00', close: '22:00' },
      thursday: { open: '09:00', close: '22:00' },
      friday: { open: '09:00', close: '23:00' },
      saturday: { open: '10:00', close: '23:00' },
      sunday: null,
    },
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const SENSITIVE_FIELDS = ['pan', 'bankIfsc', 'bankAccountNumber', 'passwordHash'];

  it('accepts the full onboarding payload and persists the public fields', async () => {
    const restaurant = await signUpRestaurant(app, fullOnboarding);
    const res = await request(app.getHttpServer()).get(`/restaurants/${restaurant.id}`).expect(200);

    expect(res.body.ownerEmail).toBe('owner@example.com');
    expect(res.body.whatsappNumber).toBe('9876543210');
    expect(res.body.fssaiNumber).toBe('12345678901234');
    expect(res.body.gstin).toBe('36AAMCR7443M1ZP');
    expect(res.body.legalEntityName).toBe('MEHFIL RESTAURANT PRIVATE LIMITED');
    expect(res.body.isVegOnly).toBe(true);
    expect(res.body.costForTwo).toBe(400);
    expect(res.body.weeklyHours.friday).toEqual({ open: '09:00', close: '23:00' });
    expect(res.body.weeklyHours.sunday).toBeNull();
  });

  it('exposes the real stored coordinates on GET, matching what was set at signup', async () => {
    const restaurant = await signUpRestaurant(app, { latitude: 17.44, longitude: 78.38 });
    const res = await request(app.getHttpServer()).get(`/restaurants/${restaurant.id}`).expect(200);
    expect(res.body.latitude).toBeCloseTo(17.44, 3);
    expect(res.body.longitude).toBeCloseTo(78.38, 3);
  });

  it('lets the owner correct a wrong location, and it actually takes — this is the fix for ' +
    'the bug where a restaurant had no way to correct a bad pin and riders got navigated ' +
    'to the wrong place', async () => {
    const restaurant = await signUpRestaurant(app, { latitude: 17.44, longitude: 78.38 });

    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ latitude: 17.4062, longitude: 78.5589 }) // real Uppal, Hyderabad coordinates
      .expect(200);

    const res = await request(app.getHttpServer()).get(`/restaurants/${restaurant.id}`).expect(200);
    expect(res.body.latitude).toBeCloseTo(17.4062, 3);
    expect(res.body.longitude).toBeCloseTo(78.5589, 3);
  });

  it('never exposes PAN or bank details in create, findOne, or list responses', async () => {
    // The create response is the sneakiest path — it used to return a raw DB row that
    // bypassed @Exclude serialization entirely.
    const created = await request(app.getHttpServer())
      .post('/restaurants')
      .send({
        ownerName: 'Privacy Test',
        name: `Privacy Test Restaurant ${Date.now()}`,
        cuisineType: 'Test',
        address: 'Test',
        phone: `9${String(Date.now()).slice(-9)}`,
        latitude: 17.44,
        longitude: 78.38,
        ...fullOnboarding,
      })
      .expect(201);

    for (const field of SENSITIVE_FIELDS) {
      expect(created.body).not.toHaveProperty(field);
    }

    const one = await request(app.getHttpServer()).get(`/restaurants/${created.body.id}`).expect(200);
    const list = await request(app.getHttpServer()).get('/restaurants').expect(200);
    const inList = list.body.find((r: any) => r.id === created.body.id);
    for (const field of SENSITIVE_FIELDS) {
      expect(one.body).not.toHaveProperty(field);
      expect(inList).not.toHaveProperty(field);
    }

    // The nearby endpoint too — it builds its response differently (distance merged onto each
    // entity) and once leaked every one of these fields, password hashes included, because a
    // spread copy bypassed @Exclude serialization. Approve the restaurant so nearby returns it.
    const adminToken = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${created.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' })
      .expect(200);
    const nearby = await request(app.getHttpServer()).get('/restaurants/nearby?lat=17.44&lng=78.38').expect(200);
    const inNearby = nearby.body.find((r: any) => r.id === created.body.id);
    expect(inNearby).toBeDefined();
    for (const field of SENSITIVE_FIELDS) {
      expect(inNearby).not.toHaveProperty(field);
    }
  });

  describe('validation', () => {
    async function expectRejected(overrides: Record<string, any>) {
      const res = await request(app.getHttpServer())
        .post('/restaurants')
        .send({
          ownerName: 'Validation Test',
          name: 'Validation Test Restaurant',
          cuisineType: 'Test',
          address: 'Test',
          phone: '9876543210',
          latitude: 17.44,
          longitude: 78.38,
          ...overrides,
        });
      expect(res.status).toBe(400);
    }

    it('rejects malformed KYC and contact fields', async () => {
      await expectRejected({ pan: 'not-a-pan' });
      await expectRejected({ pan: 'aamcr7443m' }); // lowercase — PAN is uppercase-only
      await expectRejected({ fssaiNumber: '1234' }); // must be 14 digits
      await expectRejected({ gstin: 'INVALIDGSTIN123' });
      await expectRejected({ bankIfsc: 'HD001234' });
      await expectRejected({ bankAccountNumber: '123' }); // too short
      await expectRejected({ ownerEmail: 'not-an-email' });
      await expectRejected({ whatsappNumber: '12345' }); // not a 10-digit mobile
      await expectRejected({ costForTwo: 0 });
    });

    it('rejects malformed weeklyHours shapes', async () => {
      await expectRejected({ weeklyHours: { funday: { open: '09:00', close: '22:00' } } }); // fake day
      await expectRejected({ weeklyHours: { monday: { open: '9am', close: '22:00' } } }); // not HH:MM
      await expectRejected({ weeklyHours: { monday: { open: '09:00' } } }); // missing close
      await expectRejected({ weeklyHours: [{ open: '09:00', close: '22:00' }] }); // array, not object
    });
  });

  describe('KYC endpoint access control', () => {
    it('returns the sensitive fields to an admin', async () => {
      const restaurant = await signUpRestaurant(app, fullOnboarding);
      const adminToken = await adminLogin(app);
      const res = await request(app.getHttpServer())
        .get(`/restaurants/${restaurant.id}/kyc`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.pan).toBe('AAMCR7443M');
      expect(res.body.bankIfsc).toBe('HDFC0001234');
      expect(res.body.bankAccountNumber).toBe('123456789012');
      expect(res.body.fssaiExpiry).toBe('2027-03-31');
    });

    it('lets the owner view their own KYC but not another restaurant’s', async () => {
      const restaurant = await signUpRestaurant(app, fullOnboarding);
      const other = await signUpRestaurant(app);

      const own = await request(app.getHttpServer())
        .get(`/restaurants/${restaurant.id}/kyc`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .expect(200);
      expect(own.body.pan).toBe('AAMCR7443M');

      await request(app.getHttpServer())
        .get(`/restaurants/${restaurant.id}/kyc`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);
    });

    it('rejects customers and anonymous callers', async () => {
      const restaurant = await signUpRestaurant(app, fullOnboarding);
      const customer = await signUpCustomer(app);
      await request(app.getHttpServer())
        .get(`/restaurants/${restaurant.id}/kyc`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(403);
      await request(app.getHttpServer()).get(`/restaurants/${restaurant.id}/kyc`).expect(401);
    });

    it('lets an owner add bank details AFTER signup — the wizard\'s "skip for now" promise', async () => {
      // Registered without any documents (the wizard allows skipping all of step 2)
      const restaurant = await signUpRestaurant(app);
      const adminToken = await adminLogin(app);
      const before = await request(app.getHttpServer())
        .get(`/restaurants/${restaurant.id}/kyc`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(before.body.bankIfsc).toBeNull();

      // Later, via the Settings screen, the owner adds what payouts need
      await request(app.getHttpServer())
        .patch(`/restaurants/${restaurant.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ bankIfsc: 'ICIC0004321', bankAccountNumber: '987654321098', pan: 'FGHIJ5678K' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/restaurants/${restaurant.id}/kyc`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(after.body.bankIfsc).toBe('ICIC0004321');
      expect(after.body.bankAccountNumber).toBe('987654321098');
      expect(after.body.pan).toBe('FGHIJ5678K');

      // Still never public, even after being set via PATCH
      const pub = await request(app.getHttpServer()).get(`/restaurants/${restaurant.id}`).expect(200);
      expect(pub.body).not.toHaveProperty('pan');
      expect(pub.body).not.toHaveProperty('bankAccountNumber');
    });

    it('clears an optional field when the owner saves it as null (Settings "removed means removed")', async () => {
      const restaurant = await signUpRestaurant(app, fullOnboarding);
      await request(app.getHttpServer())
        .patch(`/restaurants/${restaurant.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ gstin: null, legalEntityName: null })
        .expect(200);
      const adminToken = await adminLogin(app);
      const kyc = await request(app.getHttpServer())
        .get(`/restaurants/${restaurant.id}/kyc`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(kyc.body.gstin).toBeNull();
      expect(kyc.body.legalEntityName).toBeNull();
    });
  });

  describe('per-day hours gate order placement', () => {
    // Build a weeklyHours where today is explicitly closed / open, regardless of when CI
    // runs. Must use the same India wall-clock the backend actually checks against
    // (isWithinOperatingHours / isWithinWeeklyHours both evaluate in RESTAURANT_TIME_ZONE) —
    // using the test runner's local/UTC day here caused a real, reproducible flake: for the
    // ~5.5 hours where the UTC calendar day and the IST calendar day disagree (roughly
    // 18:30-23:59 UTC, i.e. the first few hours of the next IST day), this test set hours
    // for the wrong day and then failed asserting against the right one.
    const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = DAY_KEYS[wallClockParts(new Date(), RESTAURANT_TIME_ZONE).day];

    async function approvedRestaurantWithHours(weeklyHours: Record<string, any>) {
      const restaurant = await signUpRestaurant(app);
      const adminToken = await adminLogin(app);
      await request(app.getHttpServer())
        .patch(`/restaurants/${restaurant.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/restaurants/${restaurant.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ weeklyHours })
        .expect(200);
      const menuItem = await request(app.getHttpServer())
        .post('/menu-items')
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ restaurantId: restaurant.id, name: 'Hours Test Item', price: 100, category: 'main' })
        .expect(201);
      return { restaurant, menuItemId: menuItem.body.id };
    }

    async function placeOrder(restaurantId: string, menuItemId: string) {
      const customer = await signUpCustomer(app);
      return request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          restaurantId,
          items: [{ menuItemId, quantity: 1 }],
          deliveryAddress: 'Hours Test Address',
          latitude: 17.44,
          longitude: 78.38,
        });
    }

    it('rejects an order on a day marked closed, with a helpful message', async () => {
      const { restaurant, menuItemId } = await approvedRestaurantWithHours({ [today]: null });
      const res = await placeOrder(restaurant.id, menuItemId);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('closed today');
    });

    it('accepts an order when today’s window covers the whole day', async () => {
      const { restaurant, menuItemId } = await approvedRestaurantWithHours({
        [today]: { open: '00:00', close: '23:59' },
      });
      const res = await placeOrder(restaurant.id, menuItemId);
      expect(res.status).toBe(201);
    });

    it('per-day hours override the legacy single window', async () => {
      // Legacy fields say always-open; weeklyHours says closed today — weeklyHours must win
      const { restaurant, menuItemId } = await approvedRestaurantWithHours({ [today]: null });
      await request(app.getHttpServer())
        .patch(`/restaurants/${restaurant.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ openTime: '00:00', closeTime: '23:59' })
        .expect(200);
      const res = await placeOrder(restaurant.id, menuItemId);
      expect(res.status).toBe(400);
    });
  });
});
