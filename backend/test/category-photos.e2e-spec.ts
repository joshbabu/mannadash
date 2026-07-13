import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CategoryPhotosService } from '../src/menu-items/category-photos.service';
import * as stockPhotoUtil from '../src/menu-items/stock-photo.util';
import { adminLogin, createTestApp, signUpRestaurant } from './test-helpers';

/**
 * Unit-style tests for the caching layer specifically — mocked fetchStockPhoto, since this
 * sandbox (and likely CI) can't reach the real Unsplash/Wikimedia APIs to test the actual
 * photo lookup itself. What's genuinely testable and worth testing here is the caching
 * behavior: one shared fetch across concurrent callers, a real TTL, and that one failed
 * category lookup doesn't take down the other 14.
 */
describe('CategoryPhotosService caching (unit)', () => {
  let service: CategoryPhotosService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CategoryPhotosService],
    }).compile();
    service = moduleRef.get(CategoryPhotosService);
    jest.restoreAllMocks();
  });

  it('returns a photo URL (or null) for every one of the 15 categories', async () => {
    jest.spyOn(stockPhotoUtil, 'fetchStockPhoto').mockImplementation(async (label) => `https://example.com/${label}.jpg`);
    const result = await service.getCategoryPhotos();
    expect(Object.keys(result)).toHaveLength(15);
    expect(result['Biryani']).toBe('https://example.com/Biryani.jpg');
    expect(result['Ice Cream']).toBe('https://example.com/Ice Cream.jpg');
  });

  it('caches results — a second call within the TTL does not re-fetch', async () => {
    const spy = jest.spyOn(stockPhotoUtil, 'fetchStockPhoto').mockImplementation(async () => 'https://example.com/photo.jpg');
    await service.getCategoryPhotos();
    const callCountAfterFirst = spy.mock.calls.length;
    await service.getCategoryPhotos();
    expect(spy.mock.calls.length).toBe(callCountAfterFirst); // no new calls on the cached second call
  });

  it('concurrent calls while the cache is cold share one fetch, not one each', async () => {
    const spy = jest.spyOn(stockPhotoUtil, 'fetchStockPhoto').mockImplementation(async () => 'https://example.com/photo.jpg');
    // Fire multiple calls before any of them could possibly have finished and populated the cache
    await Promise.all([service.getCategoryPhotos(), service.getCategoryPhotos(), service.getCategoryPhotos()]);
    // 15 categories × 1 shared fetch round, not × 3 concurrent callers
    expect(spy.mock.calls.length).toBe(15);
  });

  it('one category failing to fetch does not break the other 14', async () => {
    jest.spyOn(stockPhotoUtil, 'fetchStockPhoto').mockImplementation(async (label) => {
      if (label === 'Pizza') throw new Error('simulated lookup failure');
      return `https://example.com/${label}.jpg`;
    });
    const result = await service.getCategoryPhotos();
    expect(result['Pizza']).toBeNull();
    expect(result['Biryani']).toBe('https://example.com/Biryani.jpg');
    expect(Object.keys(result)).toHaveLength(15);
  });

  it('a category with genuinely no photo available returns null, not an error or omission', async () => {
    jest.spyOn(stockPhotoUtil, 'fetchStockPhoto').mockImplementation(async () => null);
    const result = await service.getCategoryPhotos();
    expect(result['Biryani']).toBeNull();
    expect('Biryani' in result).toBe(true);
  });

  afterAll(() => {
    // Without this, the last test's mock (fetchStockPhoto always returning null) would
    // still be active when the e2e describe block below runs its real app — making its
    // "everything is null because the network is blocked" assertion pass for the wrong
    // reason (a leftover mock) rather than genuinely real, unmocked behavior.
    jest.restoreAllMocks();
  });
});

describe('GET /menu-items/category-photos (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is publicly reachable with no authentication — same category chips for every customer', async () => {
    const res = await request(app.getHttpServer()).get('/menu-items/category-photos').expect(200);
    expect(Object.keys(res.body)).toHaveLength(15);
    expect(res.body).toHaveProperty('Biryani');
    expect(res.body).toHaveProperty('Ice Cream');
    // Real network is blocked in this sandbox (no UNSPLASH_ACCESS_KEY, Wikimedia unreachable),
    // so every value is genuinely null here — that's the correct, safe fallback behavior,
    // not a broken test. The mocked unit tests above prove the actual photo-URL path works.
    expect(res.body['Biryani']).toBeNull();
  });

  it('does not 404 or break the route for :id lookups on real menu item IDs', async () => {
    // Regression check for the route-ordering fix — category-photos must be registered
    // before :id, or NestJS would try to parse "category-photos" as a UUID and 400
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
      .send({ restaurantId: restaurant.id, name: 'Route Order Test Dish', price: 100, category: 'main' })
      .expect(201);
    await request(app.getHttpServer()).get(`/menu-items/${item.body.id}`).expect(200);
    await request(app.getHttpServer()).get('/menu-items/category-photos').expect(200);
  });
});
