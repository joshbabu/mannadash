import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpCustomer, signUpRestaurant } from './test-helpers';

/**
 * Phase J: item variants & add-ons. A dish can have several customization axes (Size,
 * Spice Level, Add-ons), each either required-single (radio), optional-single, or
 * multiple (checkboxes). The rules under test, matching how Zomato-style pickers behave:
 *  - a required group must have a selection before the order is accepted
 *  - a 'single' group can have at most one option chosen, whether required or not
 *  - a 'multiple' group allows any number, including zero if not required
 *  - the final price is always base price + every selected option's priceDelta —
 *    computed server-side, never trusting a client-sent total
 *  - selecting an option that doesn't genuinely belong to the dish is rejected (the
 *    obvious spoofing attempt: pointing at another restaurant's cheaper/pricier option)
 *  - what was actually chosen is snapshotted onto the order line, surviving later edits
 *    or deletion of the variant itself — same principle as priceAtOrder
 */
describe('Menu item variants & add-ons (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApprovedRestaurantWithDish(price = 139) {
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
      .send({ restaurantId: restaurant.id, name: 'Litti Chokha', price, category: 'main' })
      .expect(201);
    return { restaurant, menuItemId: item.body.id };
  }

  function placeOrder(restaurantId: string, customer: any, items: any[]) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        restaurantId,
        items,
        deliveryAddress: 'Variant Test Address',
        latitude: 17.45,
        longitude: 78.39,
      });
  }

  describe('managing variant groups (restaurant-owner-guarded)', () => {
    it('creates a group with its options in one call, and rejects a non-owner', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
      const res = await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({
          name: 'Size',
          required: true,
          selectionType: 'single',
          options: [
            { label: 'Small', priceDelta: 0 },
            { label: 'Large', priceDelta: 60 },
          ],
        })
        .expect(201);
      expect(res.body.name).toBe('Size');
      expect(res.body.options).toHaveLength(2);
      expect(res.body.options.map((o: any) => o.label)).toEqual(['Small', 'Large']);

      const other = await signUpRestaurant(app);
      await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ name: 'Hack', options: [{ label: 'x', priceDelta: 0 }] })
        .expect(403);
    });

    it('edits a group: rename, and sync its options (upsert existing, add new, drop removed)', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
      const group = await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ name: 'Size', options: [{ label: 'Small', priceDelta: 0 }, { label: 'Medium', priceDelta: 30 }] })
        .expect(201);
      const smallId = group.body.options.find((o: any) => o.label === 'Small').id;

      const updated = await request(app.getHttpServer())
        .patch(`/menu-items/variant-groups/${group.body.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({
          name: 'Portion Size', // renamed
          options: [
            { id: smallId, label: 'Small', priceDelta: 0 }, // kept, unchanged
            { label: 'Large', priceDelta: 60 }, // new — Medium is dropped by omission
          ],
        })
        .expect(200);
      expect(updated.body.name).toBe('Portion Size');
      expect(updated.body.options).toHaveLength(2);
      expect(updated.body.options.map((o: any) => o.label).sort()).toEqual(['Large', 'Small']);
      expect(updated.body.options.find((o: any) => o.label === 'Small').id).toBe(smallId); // id preserved
    });

    it('deletes a group, and rejects a non-owner from deleting or editing', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
      const group = await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ name: 'Size', options: [{ label: 'Small', priceDelta: 0 }] })
        .expect(201);

      const other = await signUpRestaurant(app);
      await request(app.getHttpServer())
        .patch(`/menu-items/variant-groups/${group.body.id}`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ name: 'Hacked' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/menu-items/variant-groups/${group.body.id}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/menu-items/variant-groups/${group.body.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .expect(200);
      const item = await request(app.getHttpServer()).get(`/menu-items/${menuItemId}`).expect(200);
      expect(item.body.variantGroups).toHaveLength(0);
    });
  });

  describe('ordering with variants', () => {
    it('computes price as base + selected delta, and persists the selection snapshot', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(139);
      const group = await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({
          name: 'Size',
          required: true,
          selectionType: 'single',
          options: [{ label: 'Small', priceDelta: 0 }, { label: 'Large', priceDelta: 60 }],
        })
        .expect(201);
      const largeId = group.body.options.find((o: any) => o.label === 'Large').id;

      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, [
        { menuItemId, quantity: 2, selectedOptionIds: [largeId] },
      ]).expect(201);

      expect(Number(order.body.items[0].priceAtOrder)).toBe(199); // 139 + 60
      expect(Number(order.body.subtotal)).toBe(398); // 199 × 2
      expect(order.body.items[0].selectedOptions).toHaveLength(1);
      expect(order.body.items[0].selectedOptions[0]).toMatchObject({
        groupName: 'Size',
        optionLabel: 'Large',
      });
      expect(Number(order.body.items[0].selectedOptions[0].priceDeltaAtOrder)).toBe(60);
    });

    it('rejects an order missing a required group', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
      await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ name: 'Size', required: true, options: [{ label: 'Small', priceDelta: 0 }] })
        .expect(201);

      const customer = await signUpCustomer(app);
      const res = await placeOrder(restaurant.id, customer, [{ menuItemId, quantity: 1 }]).expect(400);
      expect(res.body.message).toContain('Size');
    });

    it('allows a dish with no variant groups to order exactly as before', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(100);
      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, [{ menuItemId, quantity: 1 }]).expect(201);
      expect(Number(order.body.items[0].priceAtOrder)).toBe(100);
      expect(order.body.items[0].selectedOptions).toHaveLength(0);
    });

    it('rejects more than one selection from a single-choice group, even if optional', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish();
      const group = await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({
          name: 'Spice Level',
          required: false,
          selectionType: 'single',
          options: [{ label: 'Mild', priceDelta: 0 }, { label: 'Hot', priceDelta: 0 }],
        })
        .expect(201);
      const [mildId, hotId] = group.body.options.map((o: any) => o.id);

      const customer = await signUpCustomer(app);
      const res = await placeOrder(restaurant.id, customer, [
        { menuItemId, quantity: 1, selectedOptionIds: [mildId, hotId] },
      ]).expect(400);
      expect(res.body.message).toContain('Spice Level');
    });

    it('allows any number of selections from a multiple-choice group, including zero when optional', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(150);
      const group = await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({
          name: 'Add-ons',
          required: false,
          selectionType: 'multiple',
          options: [
            { label: 'Extra cheese', priceDelta: 20 },
            { label: 'Extra sauce', priceDelta: 10 },
          ],
        })
        .expect(201);
      const [cheeseId, sauceId] = group.body.options.map((o: any) => o.id);
      const customer = await signUpCustomer(app);

      // Zero selected from an optional multiple group — fine
      const none = await placeOrder(restaurant.id, customer, [{ menuItemId, quantity: 1 }]).expect(201);
      expect(Number(none.body.items[0].priceAtOrder)).toBe(150);

      // Both selected — fine, and both price deltas apply
      const both = await placeOrder(restaurant.id, customer, [
        { menuItemId, quantity: 1, selectedOptionIds: [cheeseId, sauceId] },
      ]).expect(201);
      expect(Number(both.body.items[0].priceAtOrder)).toBe(180); // 150 + 20 + 10
      expect(both.body.items[0].selectedOptions).toHaveLength(2);
    });

    it('rejects an option id that does not belong to this menu item — the spoofing case', async () => {
      const dishA = await setupApprovedRestaurantWithDish(100);
      const dishB = await setupApprovedRestaurantWithDish(500); // a pricier dish at a different restaurant
      const groupB = await request(app.getHttpServer())
        .post(`/menu-items/${dishB.menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${dishB.restaurant.token}`)
        .send({ name: 'Size', options: [{ label: 'Large', priceDelta: 0 }] })
        .expect(201);
      const foreignOptionId = groupB.body.options[0].id;

      const customer = await signUpCustomer(app);
      // Trying to attach dish B's option to an order for dish A — must be rejected, not
      // silently accepted (which would let a customer manipulate price via a foreign id)
      const res = await placeOrder(dishA.restaurant.id, customer, [
        { menuItemId: dishA.menuItemId, quantity: 1, selectedOptionIds: [foreignOptionId] },
      ]).expect(400);
      expect(res.body.message).toContain('invalid customization');
    });

    it('keeps the selection snapshot on a past order after the variant group is deleted', async () => {
      const { restaurant, menuItemId } = await setupApprovedRestaurantWithDish(139);
      const group = await request(app.getHttpServer())
        .post(`/menu-items/${menuItemId}/variant-groups`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .send({ name: 'Size', options: [{ label: 'Large', priceDelta: 60 }] })
        .expect(201);
      const largeId = group.body.options[0].id;

      const customer = await signUpCustomer(app);
      const order = await placeOrder(restaurant.id, customer, [
        { menuItemId, quantity: 1, selectedOptionIds: [largeId] },
      ]).expect(201);

      await request(app.getHttpServer())
        .delete(`/menu-items/variant-groups/${group.body.id}`)
        .set('Authorization', `Bearer ${restaurant.token}`)
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/orders/${order.body.id}`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);
      expect(after.body.items[0].selectedOptions[0]).toMatchObject({ groupName: 'Size', optionLabel: 'Large' });
      expect(Number(after.body.items[0].priceAtOrder)).toBe(199); // unchanged — historical price stands
    });
  });
});
