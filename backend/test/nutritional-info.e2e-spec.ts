import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminLogin, createTestApp, signUpRestaurant } from './test-helpers';

/**
 * Phase K: nutritional info per serving. Deliberately thin — five optional gram fields,
 * no server-side validation beyond non-negative, and no stored calorie count (the roadmap
 * calls for deriving it as 4×protein + 4×carbs + 9×fat wherever it's displayed, so a
 * manually-typed number can never drift from the macros that supposedly produced it —
 * tested here as "the field simply doesn't exist to send", not a computation).
 */
describe('Menu item nutritional info (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupApprovedRestaurant() {
    const restaurant = await signUpRestaurant(app);
    const admin = await adminLogin(app);
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurant.id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' })
      .expect(200);
    return restaurant;
  }

  it('accepts nutritional info at creation and returns it unchanged', async () => {
    const restaurant = await setupApprovedRestaurant();
    const res = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({
        restaurantId: restaurant.id,
        name: 'Litti Chokha',
        price: 139,
        category: 'main',
        weightGrams: 250,
        proteinGrams: 12,
        carbsGrams: 40,
        fatGrams: 8,
        fibreGrams: 5,
      })
      .expect(201);
    expect(Number(res.body.weightGrams)).toBe(250);
    expect(Number(res.body.proteinGrams)).toBe(12);
    expect(Number(res.body.carbsGrams)).toBe(40);
    expect(Number(res.body.fatGrams)).toBe(8);
    expect(Number(res.body.fibreGrams)).toBe(5);
    // No stored calorie field at all — it's derived on display, never persisted
    expect(res.body).not.toHaveProperty('calorieCount');
    expect(res.body).not.toHaveProperty('calories');
  });

  it('is entirely optional — a dish with no nutritional info creates fine, fields come back null', async () => {
    const restaurant = await setupApprovedRestaurant();
    const res = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Mystery Dish', price: 100, category: 'main' })
      .expect(201);
    expect(res.body.weightGrams).toBeNull();
    expect(res.body.proteinGrams).toBeNull();
  });

  it('rejects a negative value — a dish cannot have -5g of protein', async () => {
    const restaurant = await setupApprovedRestaurant();
    await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Bad Dish', price: 100, category: 'main', proteinGrams: -5 })
      .expect(400);
  });

  it('can be added later via PATCH — the wizard/creation step never forces it up front', async () => {
    const restaurant = await setupApprovedRestaurant();
    const created = await request(app.getHttpServer())
      .post('/menu-items')
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ restaurantId: restaurant.id, name: 'Add Later Dish', price: 120, category: 'main' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/menu-items/${created.body.id}`)
      .set('Authorization', `Bearer ${restaurant.token}`)
      .send({ weightGrams: 300, proteinGrams: 20, carbsGrams: 30, fatGrams: 10, fibreGrams: 4 })
      .expect(200);
    expect(Number(updated.body.proteinGrams)).toBe(20);

    // A non-owner still can't touch it — same ownership guard as every other menu-item mutation
    const other = await setupApprovedRestaurant();
    await request(app.getHttpServer())
      .patch(`/menu-items/${created.body.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ proteinGrams: 999 })
      .expect(403);
  });
});
