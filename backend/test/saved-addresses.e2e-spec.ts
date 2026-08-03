import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';

/**
 * Saved addresses — this backend (Customer.savedLocations JSONB + the three endpoints)
 * was already fully built in an earlier session, just never had test coverage and the
 * customer app's checkout screen never actually called getAddresses() to populate the
 * list it already had UI for. Both gaps closed in the same pass as My Account.
 */
describe('Saved addresses (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a new customer starts with no saved addresses', async () => {
    const customer = await signUpCustomer(app);
    const res = await request(app.getHttpServer())
      .get('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('can add an address and see it in the list, with a generated id', async () => {
    const customer = await signUpCustomer(app);
    const res = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home', address: '2-129/2/a Vijayapuri Colony', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].label).toBe('Home');
    expect(res.body[0].id).toBeTruthy();
  });

  it('saves addressDetails (floor/flat/tower) alongside the address when provided', async () => {
    const customer = await signUpCustomer(app);
    const res = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        label: 'Home',
        address: 'Sairam Colony, Vijayapuri Colony, Uppal',
        addressDetails: '2-129, Pulipati Nilayam, 2/A',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);
    expect(res.body[0].addressDetails).toBe('2-129, Pulipati Nilayam, 2/A');
  });

  it('addressDetails is optional — an address without it saves fine and has no such field set', async () => {
    const customer = await signUpCustomer(app);
    const res = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home', address: 'Uppal, Hyderabad', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    expect(res.body[0].addressDetails).toBeUndefined();
  });

  it('can save multiple addresses, and they persist across separate requests', async () => {
    const customer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home', address: 'Addr 1', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Work', address: 'Addr 2', latitude: 17.44, longitude: 78.38 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((a: any) => a.label)).toEqual(expect.arrayContaining(['Home', 'Work']));
  });

  it('can remove a saved address by id', async () => {
    const customer = await signUpCustomer(app);
    const added = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home', address: 'Addr 1', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    const addressId = added.body[0].id;

    const afterRemove = await request(app.getHttpServer())
      .delete(`/customers/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(afterRemove.body).toEqual([]);
  });

  it('one customer never sees another customer\'s saved addresses', async () => {
    const customerA = await signUpCustomer(app);
    const customerB = await signUpCustomer(app);
    await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ label: 'A Home', address: 'Addr A', latitude: 17.45, longitude: 78.39 })
      .expect(201);

    const bList = await request(app.getHttpServer())
      .get('/customers/me/addresses')
      .set('Authorization', `Bearer ${customerB.token}`)
      .expect(200);
    expect(bList.body).toEqual([]);
  });

  it('requires authentication — no token means no access', async () => {
    await request(app.getHttpServer()).get('/customers/me/addresses').expect(401);
  });

  it('can update a saved address\'s label and text, keeping the same id', async () => {
    const customer = await signUpCustomer(app);
    const added = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home', address: 'Old address text', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    const addressId = added.body[0].id;

    const updated = await request(app.getHttpServer())
      .patch(`/customers/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home Sweet Home', address: 'New address text' })
      .expect(200);
    expect(updated.body).toHaveLength(1);
    expect(updated.body[0].id).toBe(addressId);
    expect(updated.body[0].label).toBe('Home Sweet Home');
    expect(updated.body[0].address).toBe('New address text');
  });

  it('saves receiver name and phone for this specific address when provided', async () => {
    const customer = await signUpCustomer(app);
    const res = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        label: 'Home',
        address: 'Sairam Colony, Vijayapuri Colony, Uppal',
        receiverName: 'Joshua Pulipati',
        receiverPhone: '9876543210',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);
    expect(res.body[0].receiverName).toBe('Joshua Pulipati');
    expect(res.body[0].receiverPhone).toBe('9876543210');
  });

  it('rejects a malformed receiver phone number', async () => {
    const customer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home', address: 'Uppal, Hyderabad', receiverPhone: '12345', latitude: 17.45, longitude: 78.39 })
      .expect(400);
  });

  it('receiver name/phone are optional and independent of each other', async () => {
    const customer = await signUpCustomer(app);
    const res = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home', address: 'Uppal, Hyderabad', receiverName: 'Just A Name', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    expect(res.body[0].receiverName).toBe('Just A Name');
    expect(res.body[0].receiverPhone).toBeUndefined();
  });

  it('a partial update only changes the fields sent, leaving the rest as-is', async () => {
    const customer = await signUpCustomer(app);
    const added = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Home', address: 'Addr 1', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    const addressId = added.body[0].id;

    const updated = await request(app.getHttpServer())
      .patch(`/customers/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Renamed' })
      .expect(200);
    expect(updated.body[0].label).toBe('Renamed');
    expect(updated.body[0].address).toBe('Addr 1');
  });

  it("editing just the pin location (correcting a wrong spot) doesn't wipe an existing addressDetails — the actual edit-mode flow only sends latitude/longitude/address", async () => {
    const customer = await signUpCustomer(app);
    const added = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        label: 'Home',
        address: 'Addr 1',
        addressDetails: '2-129, Pulipati Nilayam',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);
    const addressId = added.body[0].id;

    // Matches LocationMapScreen's confirmPin() in edit mode exactly — no addressDetails key
    // in the payload at all, not even as null.
    const updated = await request(app.getHttpServer())
      .patch(`/customers/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ latitude: 17.46, longitude: 78.4, address: 'Corrected Addr' })
      .expect(200);
    expect(updated.body[0].addressDetails).toBe('2-129, Pulipati Nilayam');
    expect(updated.body[0].address).toBe('Corrected Addr');
  });

  it('updating a nonexistent address id returns 404', async () => {
    const customer = await signUpCustomer(app);
    await request(app.getHttpServer())
      .patch('/customers/me/addresses/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ label: 'Anything' })
      .expect(404);
  });

  it('one customer cannot update another customer\'s address', async () => {
    const customerA = await signUpCustomer(app);
    const customerB = await signUpCustomer(app);
    const added = await request(app.getHttpServer())
      .post('/customers/me/addresses')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ label: 'A Home', address: 'Addr A', latitude: 17.45, longitude: 78.39 })
      .expect(201);
    const addressId = added.body[0].id;

    // B has no addresses at all, so B's own list can't contain A's address id — the
    // update is scoped to B's savedLocations and correctly reports not found there.
    await request(app.getHttpServer())
      .patch(`/customers/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${customerB.token}`)
      .send({ label: 'Hijacked' })
      .expect(404);

    const aList = await request(app.getHttpServer())
      .get('/customers/me/addresses')
      .set('Authorization', `Bearer ${customerA.token}`)
      .expect(200);
    expect(aList.body[0].label).toBe('A Home');
  });

  it('updating an address requires authentication', async () => {
    await request(app.getHttpServer())
      .patch('/customers/me/addresses/00000000-0000-0000-0000-000000000000')
      .send({ label: 'Anything' })
      .expect(401);
  });
});

describe('Favorite restaurants (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function approvedRestaurant() {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    return restaurant;
  }

  it('a new customer starts with no favorites', async () => {
    const customer = await signUpCustomer(app);
    const res = await request(app.getHttpServer())
      .get('/customers/me/favorites')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('can favorite a restaurant and see its full details in the list, not just an id', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await approvedRestaurant();
    await request(app.getHttpServer())
      .post(`/customers/me/favorites/${restaurant.id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/customers/me/favorites')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(restaurant.id);
    expect(res.body[0].name).toBeTruthy();
  });

  it('favoriting the same restaurant twice does not create a duplicate', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await approvedRestaurant();
    await request(app.getHttpServer())
      .post(`/customers/me/favorites/${restaurant.id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/customers/me/favorites/${restaurant.id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/customers/me/favorites')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('can remove a favorite', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await approvedRestaurant();
    await request(app.getHttpServer())
      .post(`/customers/me/favorites/${restaurant.id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/customers/me/favorites/${restaurant.id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/customers/me/favorites')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('one customer never sees another customer\'s favorites', async () => {
    const customerA = await signUpCustomer(app);
    const customerB = await signUpCustomer(app);
    const restaurant = await approvedRestaurant();
    await request(app.getHttpServer())
      .post(`/customers/me/favorites/${restaurant.id}`)
      .set('Authorization', `Bearer ${customerA.token}`)
      .expect(201);

    const bList = await request(app.getHttpServer())
      .get('/customers/me/favorites')
      .set('Authorization', `Bearer ${customerB.token}`)
      .expect(200);
    expect(bList.body).toEqual([]);
  });

  it('the favorite restaurant response never leaks sensitive fields (passwordHash, bank details)', async () => {
    const customer = await signUpCustomer(app);
    const restaurant = await approvedRestaurant();
    await request(app.getHttpServer())
      .post(`/customers/me/favorites/${restaurant.id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/customers/me/favorites')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(res.body[0]).not.toHaveProperty('passwordHash');
    expect(res.body[0]).not.toHaveProperty('bankAccountNumber');
  });
});
