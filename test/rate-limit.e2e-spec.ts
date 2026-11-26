import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  const original = {
    LOGIN_THROTTLE_LIMIT: process.env.LOGIN_THROTTLE_LIMIT,
    REGISTER_THROTTLE_LIMIT: process.env.REGISTER_THROTTLE_LIMIT,
  };

  beforeAll(async () => {
    // Los límites de @Throttle se leen en cada request: basta con fijarlos
    // antes de las peticiones.
    process.env.LOGIN_THROTTLE_LIMIT = '3';
    process.env.REGISTER_THROTTLE_LIMIT = '2';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('el request N+1 a login da 429 con Retry-After', async () => {
    const body = { email: 'nadie@example.com', password: 'Wrong123' };
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(body)
        .expect(401);
    }
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(body)
      .expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('el request N+1 a register da 429', async () => {
    const send = (n: number) =>
      request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'x', name: 'n' + n, password: 'weak' });
    await send(1).expect(400);
    await send(2).expect(400);
    const res = await send(3).expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
