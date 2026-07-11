import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';
import { Order, OrderStatus } from '../src/orders/entities/order.entity';
import { OrdersService } from '../src/orders/orders.service';

/**
 * Phase F: an order that can't get a rider shouldn't just sit there waiting for the
 * restaurant to keep clicking "Auto-assign nearest". Two independent pieces:
 *  - retryUnassignedReadyOrders(): a background sweep (30s cadence in prod, called
 *    directly here) that keeps trying assignRider() for any ready-for-pickup order with
 *    no rider — success looks identical to a manual assignment, since it reuses the
 *    exact same code path.
 *  - staleUnassignedOrders(): read-only visibility for the admin panel once an order has
 *    been trying for OrdersService.READY_STUCK_MINUTES — a human's turn to intervene.
 */
describe('No-rider-available handling (e2e)', () => {
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

  async function setupReadyForPickupOrder(restaurantOverrides: Record<string, any> = {}) {
    const restaurant = await signUpRestaurant(app, restaurantOverrides);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    const menuItem = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'No-Rider Test Dish', price: 100, category: 'main' })
      .expect(201);
    const customer = await signUpCustomer(app);
    const orderLat = restaurantOverrides.latitude ? restaurantOverrides.latitude + 0.01 : 17.45;
    const orderLng = restaurantOverrides.longitude ? restaurantOverrides.longitude + 0.01 : 78.39;
    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ menuItemId: menuItem.body.id, quantity: 1 }],
        deliveryAddress: 'No-Rider Test Address',
        latitude: orderLat,
        longitude: orderLng,
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

    return { restaurant, admin, orderId: order.body.id };
  }

  it('leaves an order alone when no rider exists at all — sweep does not throw or loop forever', async () => {
    const { orderId, restaurant } = await setupReadyForPickupOrder();
    await expect(ordersService.retryUnassignedReadyOrders()).resolves.not.toThrow();

    const after = await dataSource.getRepository(Order).findOne({ where: { id: orderId }, relations: { deliveryPartner: true } });
    expect(after!.status).toBe(OrderStatus.READY_FOR_PICKUP);
    expect(after!.deliveryPartner).toBeNull();

    // Cleanup: this order is deliberately left unassigned. If it stayed in the DB as
    // ready_for_pickup, it would sit there as a phantom candidate for every later test's
    // sweep in this file — competing for the ONE rider a later test creates and silently
    // stealing it depending on find() ordering. Cancel it so later tests aren't at the
    // mercy of leftover state from this one.
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ status: 'cancelled' })
      .expect(200);
  });

  it('auto-assigns the moment a rider becomes available — same outcome as a manual click', async () => {
    // Isolated coordinates: this assertion depends on the SWEEP reaching exactly this
    // order among whatever else is globally unassigned, so it can't share the
    // (17.44, 78.38) default every other spec file's restaurants use.
    const { orderId, admin } = await setupReadyForPickupOrder({ latitude: 19.9, longitude: 80.9 });

    // No rider yet — first sweep finds nothing
    await ordersService.retryUnassignedReadyOrders();
    let after = await dataSource.getRepository(Order).findOne({ where: { id: orderId }, relations: { deliveryPartner: true } });
    expect(after!.deliveryPartner).toBeNull();

    // A rider comes online nearby — location AND availability both need setting;
    // findNearestAvailable's radius search can't match a rider with no location at all
    const rider = await signUpRider(app);
    await request(app.getHttpServer())
      .patch(`/delivery-partners/${rider.id}/verify`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/delivery-partners/me/location')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ latitude: 19.91, longitude: 80.91 })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/delivery-partners/me/availability')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ isAvailable: true })
      .expect(200);

    // The very next sweep catches it — no manual click needed
    await ordersService.retryUnassignedReadyOrders();
    after = await dataSource.getRepository(Order).findOne({
      where: { id: orderId },
      relations: { deliveryPartner: true },
    });
    expect(after!.deliveryPartner?.id).toBe(rider.id);
  });

  describe('admin visibility for stuck orders', () => {
    async function backdateReadyAt(orderId: string, minutesAgo: number) {
      await dataSource
        .getRepository(Order)
        .update({ id: orderId }, { readyAt: new Date(Date.now() - minutesAgo * 60_000) });
    }

    it('does not surface an order that has only just gone ready', async () => {
      const { orderId, admin } = await setupReadyForPickupOrder();
      const res = await request(app.getHttpServer())
        .get('/admin/stale-unassigned-orders')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      expect(res.body.find((o: any) => o.id === orderId)).toBeUndefined();
    });

    it('surfaces an order stuck past the threshold, with restaurant/customer context and no full entity leak', async () => {
      const { orderId, admin } = await setupReadyForPickupOrder();
      await backdateReadyAt(orderId, OrdersService.READY_STUCK_MINUTES + 1);

      const res = await request(app.getHttpServer())
        .get('/admin/stale-unassigned-orders')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      const stuck = res.body.find((o: any) => o.id === orderId);
      expect(stuck).toBeDefined();
      expect(stuck.restaurantName).toBeTruthy();
      expect(stuck.customerName).toBeTruthy();
      expect(stuck.minutesWaiting).toBeGreaterThanOrEqual(OrdersService.READY_STUCK_MINUTES);
      // Shaped response — not a raw entity dump
      expect(stuck).not.toHaveProperty('deliveryAddress');
      expect(stuck).not.toHaveProperty('customer');
    });

    it('drops off the list once a rider is assigned', async () => {
      const { orderId, admin } = await setupReadyForPickupOrder({ latitude: 19.9, longitude: 80.9 });
      await backdateReadyAt(orderId, OrdersService.READY_STUCK_MINUTES + 1);

      const rider = await signUpRider(app);
      await request(app.getHttpServer())
        .patch(`/delivery-partners/${rider.id}/verify`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/location')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ latitude: 19.91, longitude: 80.91 })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/availability')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ isAvailable: true })
        .expect(200);
      await ordersService.retryUnassignedReadyOrders();

      const res = await request(app.getHttpServer())
        .get('/admin/stale-unassigned-orders')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      expect(res.body.find((o: any) => o.id === orderId)).toBeUndefined();
    });

    it('rejects non-admins', async () => {
      const customer = await signUpCustomer(app);
      await request(app.getHttpServer())
        .get('/admin/stale-unassigned-orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(403);
    });
  });
});
