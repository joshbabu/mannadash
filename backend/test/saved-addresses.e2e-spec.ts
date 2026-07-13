import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, signUpCustomer } from './test-helpers';

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
});
