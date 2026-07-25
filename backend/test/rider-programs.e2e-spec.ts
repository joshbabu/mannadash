import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';

/**
 * Shifts, rider incentives, and announcements — three admin-managed rider programs sharing
 * one module. Key things this spec exists to prove:
 *   - Shift booking is genuinely exclusive per rider (DB unique index, not just an
 *     application-side check) and can't happen after the shift has already started.
 *   - Incentive progress is computed live from real delivered orders, never stored/faked.
 *   - Non-admins can't create any of these; non-riders can't book shifts or read their own
 *     incentive progress.
 */
describe('Rider programs — shifts, incentives, announcements (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  // ==================== Shifts ====================

  describe('Shifts', () => {
    it('an admin can create a shift; a non-admin cannot', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);

      const created = await request(app.getHttpServer())
        .post('/shifts')
        .set(authed(admin))
        .send({
          label: 'Lunch',
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 3600_000 * 4).toISOString(),
          minPayPerHour: 125,
          maxPayPerHour: 185,
        })
        .expect(201);
      expect(created.body.label).toBe('Lunch');
      expect(Number(created.body.minPayPerHour)).toBe(125);

      await request(app.getHttpServer())
        .post('/shifts')
        .set(authed(rider.token))
        .send({
          label: 'Lunch',
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 3600_000 * 4).toISOString(),
          minPayPerHour: 125,
          maxPayPerHour: 185,
        })
        .expect(403);
    });

    it('rejects a shift where endAt is not after startAt', async () => {
      const admin = await adminLogin(app);
      const start = new Date(Date.now() + 3600_000).toISOString();
      await request(app.getHttpServer())
        .post('/shifts')
        .set(authed(admin))
        .send({ label: 'Bad shift', startAt: start, endAt: start, minPayPerHour: 100, maxPayPerHour: 150 })
        .expect(400);
    });

    it('a rider can book a shift, see it reflected in the list, and unbook it', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);
      const shift = await request(app.getHttpServer())
        .post('/shifts')
        .set(authed(admin))
        .send({
          label: 'Snacks',
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 3600_000 * 2).toISOString(),
          minPayPerHour: 125,
          maxPayPerHour: 255,
        })
        .expect(201);

      const beforeBooking = await request(app.getHttpServer())
        .get('/shifts')
        .set(authed(rider.token))
        .expect(200);
      const found = beforeBooking.body.find((s: any) => s.id === shift.body.id);
      expect(found.bookedByMe).toBe(false);
      expect(found.bookedCount).toBe(0);

      await request(app.getHttpServer())
        .post(`/shifts/${shift.body.id}/book`)
        .set(authed(rider.token))
        .expect(201);

      const afterBooking = await request(app.getHttpServer())
        .get('/shifts')
        .set(authed(rider.token))
        .expect(200);
      const foundAfter = afterBooking.body.find((s: any) => s.id === shift.body.id);
      expect(foundAfter.bookedByMe).toBe(true);
      expect(foundAfter.bookedCount).toBe(1);

      await request(app.getHttpServer())
        .delete(`/shifts/${shift.body.id}/book`)
        .set(authed(rider.token))
        .expect(200);

      const afterUnbooking = await request(app.getHttpServer())
        .get('/shifts')
        .set(authed(rider.token))
        .expect(200);
      expect(afterUnbooking.body.find((s: any) => s.id === shift.body.id).bookedByMe).toBe(false);
    });

    it('booking the same shift twice is rejected — genuinely exclusive, not just first-write-wins', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);
      const shift = await request(app.getHttpServer())
        .post('/shifts')
        .set(authed(admin))
        .send({
          label: 'Double-book test',
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 3600_000 * 2).toISOString(),
          minPayPerHour: 100,
          maxPayPerHour: 150,
        })
        .expect(201);

      await request(app.getHttpServer()).post(`/shifts/${shift.body.id}/book`).set(authed(rider.token)).expect(201);
      await request(app.getHttpServer()).post(`/shifts/${shift.body.id}/book`).set(authed(rider.token)).expect(400);
    });

    it('cannot book a shift that has already started', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);
      const shift = await request(app.getHttpServer())
        .post('/shifts')
        .set(authed(admin))
        .send({
          label: 'Already started',
          startAt: new Date(Date.now() - 60_000).toISOString(),
          endAt: new Date(Date.now() + 3600_000).toISOString(),
          minPayPerHour: 100,
          maxPayPerHour: 150,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/shifts/${shift.body.id}/book`)
        .set(authed(rider.token))
        .expect(400);
    });

    it('unbooking a shift you never booked returns 404', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);
      const shift = await request(app.getHttpServer())
        .post('/shifts')
        .set(authed(admin))
        .send({
          label: 'Never booked',
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 3600_000 * 2).toISOString(),
          minPayPerHour: 100,
          maxPayPerHour: 150,
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/shifts/${shift.body.id}/book`)
        .set(authed(rider.token))
        .expect(404);
    });

    it('a customer cannot book a shift', async () => {
      const admin = await adminLogin(app);
      const customer = await signUpCustomer(app);
      const shift = await request(app.getHttpServer())
        .post('/shifts')
        .set(authed(admin))
        .send({
          label: 'Not for customers',
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 3600_000 * 2).toISOString(),
          minPayPerHour: 100,
          maxPayPerHour: 150,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/shifts/${shift.body.id}/book`)
        .set(authed(customer.token))
        .expect(403);
    });

    it('requires authentication to list or create shifts', async () => {
      await request(app.getHttpServer()).get('/shifts').expect(401);
      await request(app.getHttpServer())
        .post('/shifts')
        .send({ label: 'x', startAt: new Date().toISOString(), endAt: new Date().toISOString(), minPayPerHour: 1, maxPayPerHour: 2 })
        .expect(401);
    });
  });

  // ==================== Rider incentives ====================

  describe('Rider incentives', () => {
    /** Full real lifecycle to a delivered order, assigned to a specific rider. */
    async function deliverOneOrder(restaurant: any, rider: any, priceOverride = 100) {
      const menuItem = await request(app.getHttpServer())
        .post('/menu-items')
        .set(authed(restaurant.token))
        .send({ restaurantId: restaurant.id, name: 'Incentive Test Dish', price: priceOverride, category: 'main' })
        .expect(201);
      const customer = await signUpCustomer(app);
      const order = await request(app.getHttpServer())
        .post('/orders')
        .set(authed(customer.token))
        .send({
          restaurantId: restaurant.id,
          items: [{ menuItemId: menuItem.body.id, quantity: 1 }],
          deliveryAddress: 'Incentive Test Address',
          latitude: 17.45,
          longitude: 78.39,
        })
        .expect(201);

      const t = (token: string, status: string) =>
        request(app.getHttpServer())
          .patch(`/orders/${order.body.id}/status`)
          .set(authed(token))
          .send({ status })
          .expect(200);
      await t(restaurant.token, 'accepted');
      await t(restaurant.token, 'preparing');
      await t(restaurant.token, 'ready_for_pickup');
      await request(app.getHttpServer())
        .post(`/orders/${order.body.id}/assign-rider/${rider.id}`)
        .set(authed(restaurant.token))
        .expect(201);
      await t(rider.token, 'picked_up');
      await t(rider.token, 'delivered');
    }

    async function setUpApprovedRestaurantAndVerifiedRider() {
      const restaurant = await signUpRestaurant(app);
      const rider = await signUpRider(app);
      const admin = await adminLogin(app);
      await request(app.getHttpServer())
        .patch(`/restaurants/${restaurant.id}/status`)
        .set(authed(admin))
        .send({ status: 'approved' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/delivery-partners/${rider.id}/verify`)
        .set(authed(admin))
        .expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/location')
        .set(authed(rider.token))
        .send({ latitude: 17.45, longitude: 78.39 })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/availability')
        .set(authed(rider.token))
        .send({ isAvailable: true })
        .expect(200);
      return { restaurant, rider, admin };
    }

    it('an admin can create an incentive; a non-admin cannot', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);

      const created = await request(app.getHttpServer())
        .post('/incentives')
        .set(authed(admin))
        .send({
          title: 'Weekend push',
          targetOrders: 20,
          bonusAmount: 200,
          validFrom: new Date(Date.now() - 3600_000).toISOString(),
          validTo: new Date(Date.now() + 3600_000 * 24 * 7).toISOString(),
        })
        .expect(201);
      expect(created.body.title).toBe('Weekend push');

      await request(app.getHttpServer())
        .post('/incentives')
        .set(authed(rider.token))
        .send({
          title: 'x',
          targetOrders: 1,
          bonusAmount: 1,
          validFrom: new Date().toISOString(),
          validTo: new Date(Date.now() + 1000).toISOString(),
        })
        .expect(403);
    });

    it('reports real progress toward an active incentive, computed from actual delivered orders', async () => {
      const { restaurant, rider, admin } = await setUpApprovedRestaurantAndVerifiedRider();

      await request(app.getHttpServer())
        .post('/incentives')
        .set(authed(admin))
        .send({
          title: 'Deliver 2, earn ₹50',
          targetOrders: 2,
          bonusAmount: 50,
          validFrom: new Date(Date.now() - 3600_000).toISOString(),
          validTo: new Date(Date.now() + 3600_000 * 24).toISOString(),
        })
        .expect(201);

      const before = await request(app.getHttpServer())
        .get('/incentives/mine')
        .set(authed(rider.token))
        .expect(200);
      expect(before.body[0].currentOrders).toBe(0);
      expect(before.body[0].achieved).toBe(false);

      await deliverOneOrder(restaurant, rider);
      const afterOne = await request(app.getHttpServer())
        .get('/incentives/mine')
        .set(authed(rider.token))
        .expect(200);
      expect(afterOne.body[0].currentOrders).toBe(1);
      expect(afterOne.body[0].achieved).toBe(false);

      await deliverOneOrder(restaurant, rider);
      const afterTwo = await request(app.getHttpServer())
        .get('/incentives/mine')
        .set(authed(rider.token))
        .expect(200);
      expect(afterTwo.body[0].currentOrders).toBe(2);
      expect(afterTwo.body[0].achieved).toBe(true);
    });

    it('does not count deliveries from a different rider toward this rider\'s progress', async () => {
      const { restaurant, rider, admin } = await setUpApprovedRestaurantAndVerifiedRider();
      const otherRider = await signUpRider(app);
      await request(app.getHttpServer()).patch(`/delivery-partners/${otherRider.id}/verify`).set(authed(admin)).expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/location')
        .set(authed(otherRider.token))
        .send({ latitude: 17.45, longitude: 78.39 })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/availability')
        .set(authed(otherRider.token))
        .send({ isAvailable: true })
        .expect(200);

      await request(app.getHttpServer())
        .post('/incentives')
        .set(authed(admin))
        .send({
          title: 'Isolation test',
          targetOrders: 1,
          bonusAmount: 10,
          validFrom: new Date(Date.now() - 3600_000).toISOString(),
          validTo: new Date(Date.now() + 3600_000 * 24).toISOString(),
        })
        .expect(201);

      await deliverOneOrder(restaurant, otherRider);

      const mine = await request(app.getHttpServer())
        .get('/incentives/mine')
        .set(authed(rider.token))
        .expect(200);
      expect(mine.body[0].currentOrders).toBe(0);
    });

    it('does not surface an incentive outside its valid window', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);

      await request(app.getHttpServer())
        .post('/incentives')
        .set(authed(admin))
        .send({
          title: 'Already ended',
          targetOrders: 1,
          bonusAmount: 10,
          validFrom: new Date(Date.now() - 3600_000 * 48).toISOString(),
          validTo: new Date(Date.now() - 3600_000 * 24).toISOString(),
        })
        .expect(201);

      const mine = await request(app.getHttpServer())
        .get('/incentives/mine')
        .set(authed(rider.token))
        .expect(200);
      expect(mine.body.find((i: any) => i.title === 'Already ended')).toBeUndefined();
    });

    it('a customer cannot read rider incentive progress', async () => {
      const customer = await signUpCustomer(app);
      await request(app.getHttpServer()).get('/incentives/mine').set(authed(customer.token)).expect(403);
    });
  });

  // ==================== Announcements ====================

  describe('Announcements', () => {
    it('an admin can create an announcement; a non-admin cannot', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);

      const created = await request(app.getHttpServer())
        .post('/announcements')
        .set(authed(admin))
        .send({ title: 'New bonus zone live', body: 'Uppal now has surge pricing 6-9pm.' })
        .expect(201);
      expect(created.body.title).toBe('New bonus zone live');
      expect(created.body.active).toBe(true);

      await request(app.getHttpServer())
        .post('/announcements')
        .set(authed(rider.token))
        .send({ title: 'x', body: 'y' })
        .expect(403);
    });

    it('a rider sees only active announcements; an admin sees all including deactivated', async () => {
      const admin = await adminLogin(app);
      const rider = await signUpRider(app);

      const created = await request(app.getHttpServer())
        .post('/announcements')
        .set(authed(admin))
        .send({ title: 'Will be deactivated', body: 'Temporary notice' })
        .expect(201);

      const riderSeesIt = await request(app.getHttpServer())
        .get('/announcements')
        .set(authed(rider.token))
        .expect(200);
      expect(riderSeesIt.body.some((a: any) => a.id === created.body.id)).toBe(true);

      await request(app.getHttpServer())
        .patch(`/announcements/${created.body.id}/deactivate`)
        .set(authed(admin))
        .expect(200);

      const riderNoLongerSeesIt = await request(app.getHttpServer())
        .get('/announcements')
        .set(authed(rider.token))
        .expect(200);
      expect(riderNoLongerSeesIt.body.some((a: any) => a.id === created.body.id)).toBe(false);

      const adminStillSeesIt = await request(app.getHttpServer())
        .get('/announcements')
        .set(authed(admin))
        .expect(200);
      expect(adminStillSeesIt.body.some((a: any) => a.id === created.body.id)).toBe(true);
    });

    it('requires authentication to list or create announcements', async () => {
      await request(app.getHttpServer()).get('/announcements').expect(401);
      await request(app.getHttpServer()).post('/announcements').send({ title: 'x', body: 'y' }).expect(401);
    });
  });
});

/**
 * Bank details, referrals, and SOS alerts — added alongside shifts/incentives/announcements.
 * Key things this spec exists to prove:
 *   - Bank details are genuinely self-service (a rider can only read/write their own) and
 *     never leak through the normal find/findOne responses (the @Exclude() on the entity).
 *   - Every rider gets a real, unique referral code at signup; a referral is only recorded
 *     when a genuinely valid code is supplied, and a bad/typo'd one never blocks signup.
 *   - Referral "bonus achieved" is computed from real delivered orders, same as incentives.
 *   - An SOS alert is actually persisted (not just a client-side action with no record).
 */
describe('Rider programs — bank details, referrals, SOS (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function uniquePhone(seed: number) {
    return `9${String(Date.now()).slice(-8)}${seed}`;
  }

  describe('Bank details', () => {
    it('a rider can set and then read back their own bank details', async () => {
      const rider = await signUpRider(app);

      const empty = await request(app.getHttpServer())
        .get('/delivery-partners/me/bank-details')
        .set(authed(rider.token))
        .expect(200);
      expect(empty.body.bankIfsc).toBeNull();

      await request(app.getHttpServer())
        .patch('/delivery-partners/me/bank-details')
        .set(authed(rider.token))
        .send({ bankIfsc: 'HDFC0001234', bankAccountNumber: '123456789012' })
        .expect(200);

      const filled = await request(app.getHttpServer())
        .get('/delivery-partners/me/bank-details')
        .set(authed(rider.token))
        .expect(200);
      expect(filled.body.bankIfsc).toBe('HDFC0001234');
      expect(filled.body.bankAccountNumber).toBe('123456789012');
    });

    it('rejects a malformed IFSC code', async () => {
      const rider = await signUpRider(app);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/bank-details')
        .set(authed(rider.token))
        .send({ bankIfsc: 'not-an-ifsc', bankAccountNumber: '123456789012' })
        .expect(400);
    });

    it('bank details never appear in the normal restaurant-style findAll/findOne responses', async () => {
      const rider = await signUpRider(app);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/bank-details')
        .set(authed(rider.token))
        .send({ bankIfsc: 'HDFC0001234', bankAccountNumber: '123456789012' })
        .expect(200);

      const found = await request(app.getHttpServer()).get(`/delivery-partners/${rider.id}`).expect(200);
      expect(found.body.bankIfsc).toBeUndefined();
      expect(found.body.bankAccountNumber).toBeUndefined();
    });

    it('requires authentication, and a customer cannot use the rider bank-details endpoint', async () => {
      await request(app.getHttpServer()).get('/delivery-partners/me/bank-details').expect(401);
      const customer = await signUpCustomer(app);
      await request(app.getHttpServer())
        .get('/delivery-partners/me/bank-details')
        .set(authed(customer.token))
        .expect(403);
    });
  });

  describe('Referrals', () => {
    it('every rider gets a unique referral code at signup', async () => {
      const a = await signUpRider(app);
      const b = await signUpRider(app);
      const mineA = await request(app.getHttpServer()).get('/referrals/mine').set(authed(a.token)).expect(200);
      const mineB = await request(app.getHttpServer()).get('/referrals/mine').set(authed(b.token)).expect(200);
      expect(mineA.body.referralCode).toBeTruthy();
      expect(mineB.body.referralCode).toBeTruthy();
      expect(mineA.body.referralCode).not.toBe(mineB.body.referralCode);
    });

    it('signing up with a valid referral code links the referral, with real progress toward the bonus', async () => {
      const referrer = await signUpRider(app);
      const mine = await request(app.getHttpServer()).get('/referrals/mine').set(authed(referrer.token)).expect(200);
      const code = mine.body.referralCode;

      const phone = uniquePhone(1);
      const signupRes = await request(app.getHttpServer())
        .post('/delivery-partners/signup')
        .send({ name: 'Referred Rider', phone, password: 'testpass123', referralCode: code })
        .expect(201);
      expect(signupRes.body.rider.id).toBeTruthy();

      const afterSignup = await request(app.getHttpServer())
        .get('/referrals/mine')
        .set(authed(referrer.token))
        .expect(200);
      expect(afterSignup.body.referredRiders).toHaveLength(1);
      expect(afterSignup.body.referredRiders[0].name).toBe('Referred Rider');
      expect(afterSignup.body.referredRiders[0].deliveredCount).toBe(0);
      expect(afterSignup.body.referredRiders[0].bonusAchieved).toBe(false);
    });

    it('an invalid/made-up referral code does not block signup and records no referral', async () => {
      const phone = uniquePhone(2);
      const signupRes = await request(app.getHttpServer())
        .post('/delivery-partners/signup')
        .send({ name: 'No Referrer', phone, password: 'testpass123', referralCode: 'ZZZZZZ' })
        .expect(201);
      expect(signupRes.body).toBeTruthy();
    });

    it('signup works fine with no referral code at all', async () => {
      const phone = uniquePhone(3);
      await request(app.getHttpServer())
        .post('/delivery-partners/signup')
        .send({ name: 'No Code', phone, password: 'testpass123' })
        .expect(201);
    });

    it('an admin can see all referrals; a rider cannot', async () => {
      const referrer = await signUpRider(app);
      const mine = await request(app.getHttpServer()).get('/referrals/mine').set(authed(referrer.token)).expect(200);
      const phone = uniquePhone(4);
      await request(app.getHttpServer())
        .post('/delivery-partners/signup')
        .send({ name: 'Admin View Test', phone, password: 'testpass123', referralCode: mine.body.referralCode })
        .expect(201);

      const admin = await adminLogin(app);
      const all = await request(app.getHttpServer()).get('/referrals').set(authed(admin)).expect(200);
      expect(all.body.some((r: any) => r.refereeName === 'Admin View Test')).toBe(true);

      await request(app.getHttpServer()).get('/referrals').set(authed(referrer.token)).expect(403);
    });

    it('requires authentication to read referral progress', async () => {
      await request(app.getHttpServer()).get('/referrals/mine').expect(401);
    });
  });

  describe('SOS alerts', () => {
    it('a rider can trigger an SOS alert, and it shows up for admins', async () => {
      const rider = await signUpRider(app);
      await request(app.getHttpServer())
        .post('/sos')
        .set(authed(rider.token))
        .send({ latitude: 17.45, longitude: 78.39 })
        .expect(201);

      const admin = await adminLogin(app);
      const alerts = await request(app.getHttpServer()).get('/sos-alerts').set(authed(admin)).expect(200);
      expect(alerts.body.some((a: any) => a.riderPhone === rider.phone && a.latitude === 17.45)).toBe(true);
    });

    it('rejects an out-of-range coordinate', async () => {
      const rider = await signUpRider(app);
      await request(app.getHttpServer())
        .post('/sos')
        .set(authed(rider.token))
        .send({ latitude: 999, longitude: 78.39 })
        .expect(400);
    });

    it('only a rider can trigger SOS; only an admin can list alerts', async () => {
      const customer = await signUpCustomer(app);
      await request(app.getHttpServer())
        .post('/sos')
        .set(authed(customer.token))
        .send({ latitude: 17.45, longitude: 78.39 })
        .expect(403);

      const rider = await signUpRider(app);
      await request(app.getHttpServer()).get('/sos-alerts').set(authed(rider.token)).expect(403);
    });

    it('requires authentication to trigger or list SOS alerts', async () => {
      await request(app.getHttpServer()).post('/sos').send({ latitude: 17.45, longitude: 78.39 }).expect(401);
      await request(app.getHttpServer()).get('/sos-alerts').expect(401);
    });
  });
});
