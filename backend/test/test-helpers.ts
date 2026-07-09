import { Test } from '@nestjs/testing';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { json } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Boots a real Nest app against the test database, with the exact same global
 * pipes/interceptors/middleware main.ts applies in production — so these tests exercise the
 * real validation and serialization behavior, not a simplified stand-in. Keep this in sync with
 * main.ts whenever that file changes, or tests can silently drift from what production actually
 * does (this is exactly how the body-size-limit test initially failed — worth remembering).
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication();
  app.use(json({ limit: '10mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.init();
  return app;
}

let counter = 0;
function uniquePhone(): string {
  counter += 1;
  // Must be exactly 10 digits, starting with 6-9, per the app's validation regex.
  // Combine a slice of the current time with the counter, then pad/truncate to exactly 9 digits.
  const raw = `${Date.now()}${counter}`.slice(-9).padStart(9, '0');
  return `9${raw}`;
}

export async function signUpCustomer(app: INestApplication, name = 'Test Customer') {
  const phone = uniquePhone();
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name, phone, password: 'testpass123' })
    .expect(201);
  return { token: res.body.accessToken, phone, name };
}

export async function signUpRestaurant(app: INestApplication, overrides: Record<string, any> = {}) {
  const phone = uniquePhone();
  // Real flow is two steps: apply (public, creates a pending restaurant), then claim with a password
  const created = await request(app.getHttpServer())
    .post('/restaurants')
    .send({
      ownerName: 'Test Owner',
      name: `Test Restaurant ${phone}`,
      cuisineType: 'Test Cuisine',
      address: 'Test Address',
      phone,
      latitude: 17.44,
      longitude: 78.38,
      ...overrides,
    })
    .expect(201);
  const restaurantId = created.body.id;

  const claimed = await request(app.getHttpServer())
    .post('/restaurants/signup')
    .send({ restaurantId, password: 'testpass123' })
    .expect(201);

  return { token: claimed.body.accessToken, id: restaurantId, phone };
}

export async function signUpRider(app: INestApplication) {
  const phone = uniquePhone();
  const res = await request(app.getHttpServer())
    .post('/delivery-partners/signup')
    .send({ name: 'Test Rider', phone, password: 'testpass123', vehicleType: 'bike' })
    .expect(201);
  return { token: res.body.accessToken, id: res.body.rider?.id ?? res.body.id, phone };
}

export async function adminLogin(app: INestApplication) {
  const res = await request(app.getHttpServer())
    .post('/admin/login')
    .send({
      username: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD || 'testadminpass123',
    })
    .expect(201);
  return res.body.accessToken;
}

// Directly updates payment status via the app's own DB connection — a real payment only ever
// gets marked "paid" through Razorpay's webhook, which we can't call in tests without live keys.
// This simulates that outcome so we can test what happens AFTER a payment succeeds.
export async function markOrderAsPaid(app: INestApplication, orderId: string) {
  const dataSource = app.get(DataSource);
  await dataSource.query(`UPDATE orders SET "paymentStatus" = 'paid' WHERE id = $1`, [orderId]);
}
