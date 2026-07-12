import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant, signUpRider } from './test-helpers';
import { OrdersService } from '../src/orders/orders.service';

/**
 * Delivery Type tiers (Express/Standard/Eco) and tips. Express isn't just a price tag —
 * it gets real priority in the rider-assignment sweep, tested explicitly below by putting
 * a Standard order in the queue BEFORE an Express one and confirming Express still wins
 * the one available rider. Tips are the rider's money, never the platform's or restaurant's
 * — verified by checking rider earnings directly, not just the order's own total.
 */
describe('Delivery type & tips (e2e)', () => {
  let app: INestApplication;
  let ordersService: OrdersService;

  beforeAll(async () => {
    app = await createTestApp();
    ordersService = app.get(OrdersService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApprovedRestaurantWithDish(price = 200) {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    const item = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Delivery Type Test Dish', price, category: 'main' })
      .expect(201);
    return { restaurant, menuItemId: item.body.id, admin };
  }

  function placeOrder(restaurantId: string, customer: any, menuItemId: string, extra: Record<string, any> = {}) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryAddress: 'Delivery Type Test Address',
        latitude: 17.45,
        longitude: 78.39,
        ...extra,
      });
  }

  describe('pricing', () => {
    it('defaults to standard with no surcharge when not specified', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      const customer = await signUpCustomer(app);
      const res = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      expect(res.body.deliveryType).toBe('standard');
      expect(Number(res.body.total)).toBe(Number(res.body.subtotal) + Number(res.body.deliveryFee));
    });

    it('express adds the surcharge to the total', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      const customer = await signUpCustomer(app);
      const standard = await placeOrder(restaurant.id, customer, menuItemId, { deliveryType: 'standard' }).expect(201);
      const express = await placeOrder(restaurant.id, customer, menuItemId, { deliveryType: 'express' }).expect(201);
      expect(Number(express.body.total)).toBe(Number(standard.body.total) + 29);
    });

    it('eco is a small credit off the total', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      const customer = await signUpCustomer(app);
      const standard = await placeOrder(restaurant.id, customer, menuItemId, { deliveryType: 'standard' }).expect(201);
      const eco = await placeOrder(restaurant.id, customer, menuItemId, { deliveryType: 'eco' }).expect(201);
      expect(Number(eco.body.total)).toBe(Number(standard.body.total) - 5);
    });

    it('rejects an invalid delivery type', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
      const customer = await signUpCustomer(app);
      await placeOrder(restaurant.id, customer, menuItemId, { deliveryType: 'super-fast' }).expect(400);
    });

    it('express estimates an earlier delivery time than eco', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
      const customer = await signUpCustomer(app);
      const express = await placeOrder(restaurant.id, customer, menuItemId, { deliveryType: 'express' }).expect(201);
      const eco = await placeOrder(restaurant.id, customer, menuItemId, { deliveryType: 'eco' }).expect(201);
      expect(new Date(express.body.estimatedDeliveryAt).getTime()).toBeLessThan(new Date(eco.body.estimatedDeliveryAt).getTime());
    });
  });

  describe('tips', () => {
    it('adds the tip to the total, on top of everything else', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(200);
      const customer = await signUpCustomer(app);
      const withoutTip = await placeOrder(restaurant.id, customer, menuItemId).expect(201);
      const withTip = await placeOrder(restaurant.id, customer, menuItemId, { tipAmount: 25 }).expect(201);
      expect(Number(withTip.body.total)).toBe(Number(withoutTip.body.total) + 25);
      expect(Number(withTip.body.tipAmount)).toBe(25);
    });

    it('rejects a negative tip', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
      const customer = await signUpCustomer(app);
      await placeOrder(restaurant.id, customer, menuItemId, { tipAmount: -10 }).expect(400);
    });

    it('credits the tip to the rider, on top of the delivery fee — never touched by commission', async () => {
      const { restaurant, menuItemId, admin } = await setupApprovedRestaurantWithDish(200);
      const rider = await signUpRider(app);
      await request(app.getHttpServer()).patch(`/delivery-partners/${rider.id}/verify`).set('Authorization', `Bearer ${admin}`).expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/availability')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ isAvailable: true })
        .expect(200);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, menuItemId, { tipAmount: 20 }).expect(201);

      const t = (token: string, status: string) =>
        request(app.getHttpServer())
          .patch(`/orders/${order.body.id}/status`)
          .set('Authorization', `Bearer ${token}`)
          .send({ status })
          .expect(200);
      await t(restaurant.token, 'accepted');
      await t(restaurant.token, 'preparing');
      await t(restaurant.token, 'ready_for_pickup');
      await request(app.getHttpServer())
        .post(`/orders/${order.body.id}/assign-rider/${rider.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .expect(201);
      await t(rider.token, 'picked_up');
      await t(rider.token, 'delivered');

      const earnings = await request(app.getHttpServer()).get('/orders/rider/earnings').set('Authorization', `Bearer ${rider.token}`).expect(200);
      const line = earnings.body.history.find((h: any) => h.orderId === order.body.id);
      expect(line.tipAmount).toBe(20);
      expect(line.deliveryFee).toBe(Number(order.body.deliveryFee));
      expect(line.amount).toBe(line.deliveryFee + 20);
    });
  });

  describe('real Express dispatch priority', () => {
    it('an Express order gets the one available rider before an earlier Standard order', async () => {
      // Isolated coordinates — same reasoning as the no-rider-handling spec: this test's
      // premise (exactly one rider, exactly two competing orders) only holds if nothing
      // else in a shared full-suite run has an available rider near the default location.
      const isolated = { latitude: 22.5, longitude: 84.5 };
      const { restaurant, menuItemId, admin } = await setupApprovedRestaurantWithDish(200);
      await request(app.getHttpServer())
        .patch(`/restaurants/${restaurant.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send(isolated)
        .expect(200);

      const customer = await signUpCustomer(app);
      const orderLat = isolated.latitude + 0.01;
      const orderLng = isolated.longitude + 0.01;

      // Standard order placed FIRST — if the sweep just processed orders in placedAt order,
      // this one would get the rider. It shouldn't, because Express jumps the queue.
      const standardOrder = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          restaurantId: restaurant.id,
          items: [{ menuItemId, quantity: 1 }],
          deliveryAddress: 'X',
          latitude: orderLat,
          longitude: orderLng,
          deliveryType: 'standard',
        })
        .expect(201);
      const expressOrder = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          restaurantId: restaurant.id,
          items: [{ menuItemId, quantity: 1 }],
          deliveryAddress: 'X',
          latitude: orderLat,
          longitude: orderLng,
          deliveryType: 'express',
        })
        .expect(201);

      // Both orders through to ready-for-pickup
      for (const orderId of [standardOrder.body.id, expressOrder.body.id]) {
        const t = (status: string) =>
          request(app.getHttpServer())
            .patch(`/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${restaurant.token}`)
            .send({ status })
            .expect(200);
        await t('accepted');
        await t('preparing');
        await t('ready_for_pickup');
      }

      // Exactly one rider becomes available
      const rider = await signUpRider(app);
      await request(app.getHttpServer()).patch(`/delivery-partners/${rider.id}/verify`).set('Authorization', `Bearer ${admin}`).expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/location')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ latitude: orderLat, longitude: orderLng })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/delivery-partners/me/availability')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ isAvailable: true })
        .expect(200);

      await ordersService.retryUnassignedReadyOrders();

      const express = await request(app.getHttpServer())
        .get(`/orders/${expressOrder.body.id}`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);
      const standard = await request(app.getHttpServer())
        .get(`/orders/${standardOrder.body.id}`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);

      expect(express.body.deliveryPartner?.id).toBe(rider.id); // Express got the rider
      expect(standard.body.deliveryPartner).toBeNull(); // Standard, placed first, did not
    });
  });
});
