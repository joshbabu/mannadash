import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';

/**
 * Order History endpoint for the restaurant dashboard: terminal orders only, searchable by
 * customer name / phone / order-id fragment, filterable by status and date range, with
 * summary cards (delivered / cancelled / revenue) computed over the same search+date slice.
 *
 * Seeding note: orders are created through the real API, but their terminal status and
 * placedAt are then set directly in the DB. Reaching "delivered" legitimately needs a full
 * rider lifecycle (covered exhaustively in order-lifecycle.e2e-spec) and back-dating an
 * order is impossible through any API — the history endpoint only reads state, so this is
 * the honest way to test date filters at all.
 */
describe('Restaurant order history (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupRestaurant() {
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
      .send({ restaurantId: restaurant.id, name: 'History Test Dish', price: 100, category: 'main' })
      .expect(201);
    return { restaurant, menuItemId: menuItem.body.id };
  }

  /** Creates a real order then pins its terminal state, total, and placedAt in the DB. */
  async function seedOrder(
    ctx: { restaurant: any; menuItemId: string },
    opts: { customerName?: string; status: 'delivered' | 'cancelled' | 'preparing'; total?: number; daysAgo?: number },
  ) {
    const customer = await signUpCustomer(app, opts.customerName);
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: ctx.restaurant.id,
        items: [{ menuItemId: ctx.menuItemId, quantity: 1 }],
        deliveryAddress: 'History Test Address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);

    const placedAt = new Date(Date.now() - (opts.daysAgo ?? 0) * 86400000);
    await dataSource.query(
      `UPDATE orders SET status = $1, total = $2, "placedAt" = $3 WHERE id = $4`,
      [opts.status, opts.total ?? 100, placedAt, order.body.id],
    );
    return { orderId: order.body.id as string, customer };
  }

  function getHistory(token: string, params: Record<string, any> = {}) {
    return request(app.getHttpServer())
      .get('/orders/restaurant/history')
      .set('Authorization', `Bearer ${token}`)
      .query(params);
  }

  it('returns only terminal orders, newest first, with a correct summary', async () => {
    const ctx = await setupRestaurant();
    await seedOrder(ctx, { status: 'delivered', total: 300, daysAgo: 2 });
    await seedOrder(ctx, { status: 'delivered', total: 200, daysAgo: 1 });
    await seedOrder(ctx, { status: 'cancelled', total: 150 });
    await seedOrder(ctx, { status: 'preparing', total: 999 }); // in-flight — must NOT appear

    const res = await getHistory(ctx.restaurant.token).expect(200);
    expect(res.body.orders).toHaveLength(3);
    expect(res.body.orders.map((o: any) => o.status)).toEqual(['cancelled', 'delivered', 'delivered']);
    // Revenue counts delivered only — the in-flight ₹999 and cancelled ₹150 are excluded
    expect(res.body.summary).toEqual({ delivered: 2, cancelled: 1, revenue: 500 });
    expect(res.body.total).toBe(3);
    // Rows carry what the page renders: customer name and items
    expect(res.body.orders[0].customer.user.name).toBeDefined();
    expect(res.body.orders[0].items[0].menuItem.name).toBe('History Test Dish');
  });

  it('filters by status while the summary keeps showing both terminal states', async () => {
    const ctx = await setupRestaurant();
    await seedOrder(ctx, { status: 'delivered', total: 250 });
    await seedOrder(ctx, { status: 'cancelled' });

    const res = await getHistory(ctx.restaurant.token, { status: 'cancelled' }).expect(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].status).toBe('cancelled');
    // Cards stay the fixed reference point while the list narrows
    expect(res.body.summary).toEqual({ delivered: 1, cancelled: 1, revenue: 250 });
  });

  it('searches by customer name, phone, and order-id fragment', async () => {
    const ctx = await setupRestaurant();
    const { customer } = await seedOrder(ctx, { customerName: 'Ravi Search-Target', status: 'delivered' });
    const { orderId } = await seedOrder(ctx, { customerName: 'Someone Else', status: 'delivered' });

    const byName = await getHistory(ctx.restaurant.token, { search: 'search-target' }).expect(200);
    expect(byName.body.orders).toHaveLength(1);
    expect(byName.body.orders[0].customer.user.name).toBe('Ravi Search-Target');
    // Summary follows the search — this is per-customer history at a glance
    expect(byName.body.summary.delivered).toBe(1);

    const byPhone = await getHistory(ctx.restaurant.token, { search: customer.phone }).expect(200);
    expect(byPhone.body.orders).toHaveLength(1);

    const byIdFragment = await getHistory(ctx.restaurant.token, { search: orderId.slice(0, 8) }).expect(200);
    expect(byIdFragment.body.orders).toHaveLength(1);
    expect(byIdFragment.body.orders[0].id).toBe(orderId);
  });

  it('filters by date range', async () => {
    const ctx = await setupRestaurant();
    await seedOrder(ctx, { status: 'delivered', total: 100, daysAgo: 10 });
    await seedOrder(ctx, { status: 'delivered', total: 200, daysAgo: 0 });

    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const res = await getHistory(ctx.restaurant.token, { from }).expect(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.summary.revenue).toBe(200); // the 10-day-old ₹100 falls outside the window

    const to = new Date(Date.now() - 5 * 86400000).toISOString();
    const older = await getHistory(ctx.restaurant.token, { to }).expect(200);
    expect(older.body.orders).toHaveLength(1);
    expect(older.body.summary.revenue).toBe(100);
  });

  it('paginates with limit/offset while total reflects all matches', async () => {
    const ctx = await setupRestaurant();
    for (let i = 0; i < 5; i++) await seedOrder(ctx, { status: 'delivered', daysAgo: i });

    const page1 = await getHistory(ctx.restaurant.token, { limit: 2 }).expect(200);
    expect(page1.body.orders).toHaveLength(2);
    expect(page1.body.total).toBe(5);

    const page2 = await getHistory(ctx.restaurant.token, { limit: 2, offset: 2 }).expect(200);
    expect(page2.body.orders).toHaveLength(2);
    expect(page2.body.orders[0].id).not.toBe(page1.body.orders[0].id);
  });

  it('rejects bad filter values', async () => {
    const ctx = await setupRestaurant();
    await getHistory(ctx.restaurant.token, { status: 'preparing' }).expect(400); // not a terminal state
    await getHistory(ctx.restaurant.token, { from: 'yesterday-ish' }).expect(400);
    await getHistory(ctx.restaurant.token, { limit: 5000 }).expect(400);
  });

  it("only ever returns the caller's own orders, and requires auth", async () => {
    const ctxA = await setupRestaurant();
    const ctxB = await setupRestaurant();
    await seedOrder(ctxA, { status: 'delivered', total: 400 });

    const forB = await getHistory(ctxB.restaurant.token).expect(200);
    expect(forB.body.orders).toHaveLength(0);
    expect(forB.body.summary).toEqual({ delivered: 0, cancelled: 0, revenue: 0 });

    await request(app.getHttpServer()).get('/orders/restaurant/history').expect(401);
  });
});
