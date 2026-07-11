import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';
import { Order, OrderStatus } from '../src/orders/entities/order.entity';
import { OrdersService } from '../src/orders/orders.service';

/**
 * Phase C: a restaurant that never touches a placed order shouldn't leave a customer
 * hanging forever. Two independent, cron-driven passes (called directly here rather than
 * waiting on the real 30s schedule — see order-history.e2e-spec for why back-dating via
 * the DB, not the API, is the honest way to test time-based behavior):
 *  - nudgeExpiringOrders(): a one-time "about to expire" push at the halfway mark
 *  - autoCancelStaleOrders(): cancels orders past the full timeout, reusing updateStatus
 *    so refund-flagging and rider-release can't drift from a manual cancellation
 */
describe('Order acceptance timeout (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ordersService: OrdersService;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    ordersService = app.get(OrdersService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function placeOrder() {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Timeout Test Dish', price: 100, category: 'main' })
      .expect(201);
    const customer = await signUpCustomer(app);
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: menuItem.body.id, quantity: 1 }],
        deliveryAddress: 'Timeout Test Address',
        latitude: 17.45,
        longitude: 78.39,
      })
      .expect(201);
    return { restaurant, customer, orderId: order.body.id };
  }

  /** Back-dates placedAt directly in the DB — the only honest way to simulate elapsed time. */
  async function backdatePlacedAt(orderId: string, minutesAgo: number) {
    await dataSource
      .getRepository(Order)
      .update({ id: orderId }, { placedAt: new Date(Date.now() - minutesAgo * 60_000) });
  }

  it('leaves a fresh order untouched by both sweeps', async () => {
    const { orderId } = await placeOrder();
    await ordersService.nudgeExpiringOrders();
    await ordersService.autoCancelStaleOrders();

    const after = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(after!.status).toBe(OrderStatus.PLACED);
    expect(after!.expiryNudgeSentAt).toBeNull();
  });

  it('nudges exactly once at the halfway mark, and does not auto-cancel yet', async () => {
    const { orderId } = await placeOrder();
    await backdatePlacedAt(orderId, OrdersService.NUDGE_AT_MINUTES + 0.5); // just past halfway

    await ordersService.nudgeExpiringOrders();
    const nudged = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(nudged!.expiryNudgeSentAt).not.toBeNull();

    // A second sweep must not re-nudge (expiryNudgeSentAt already set)
    const firstNudgeTime = nudged!.expiryNudgeSentAt;
    await ordersService.nudgeExpiringOrders();
    const stillOnce = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(stillOnce!.expiryNudgeSentAt).toEqual(firstNudgeTime);

    // Still well within the full timeout — auto-cancel must leave it alone
    await ordersService.autoCancelStaleOrders();
    const untouched = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(untouched!.status).toBe(OrderStatus.PLACED);
  });

  it('auto-cancels an order past the full timeout, tagged with the timeout reason, rider freed, no refund (unpaid COD)', async () => {
    const { orderId } = await placeOrder();
    await backdatePlacedAt(orderId, OrdersService.ACCEPT_TIMEOUT_MINUTES + 1);

    await ordersService.autoCancelStaleOrders();

    const after = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(after!.status).toBe(OrderStatus.CANCELLED);
    expect(after!.cancelReason).toBe('acceptance_timeout');
    expect(after!.refundStatus).toBe('none'); // unpaid COD order — nothing to refund
  });

  it('flags a refund when a paid order times out unaccepted', async () => {
    const { orderId } = await placeOrder();
    await dataSource.getRepository(Order).update({ id: orderId }, { paymentStatus: 'paid' as any });
    await backdatePlacedAt(orderId, OrdersService.ACCEPT_TIMEOUT_MINUTES + 1);

    await ordersService.autoCancelStaleOrders();

    const after = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(after!.status).toBe(OrderStatus.CANCELLED);
    expect(after!.refundStatus).toBe('pending');
    expect(Number(after!.refundAmount)).toBeGreaterThan(0);
  });

  it('distinguishes cancelReason for a manual customer cancellation vs restaurant cancellation', async () => {
    const { orderId: id1, customer } = await placeOrder();
    await request(app.getHttpServer())
      .patch(`/orders/${id1}/status`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ status: 'cancelled' })
      .expect(200);
    const byCustomer = await dataSource.getRepository(Order).findOne({ where: { id: id1 } });
    expect(byCustomer!.cancelReason).toBe('customer');

    const { orderId: id2, restaurant } = await placeOrder();
    await request(app.getHttpServer())
      .patch(`/orders/${id2}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'cancelled' })
      .expect(200);
    const byRestaurant = await dataSource.getRepository(Order).findOne({ where: { id: id2 } });
    expect(byRestaurant!.cancelReason).toBe('restaurant');
  });
});
