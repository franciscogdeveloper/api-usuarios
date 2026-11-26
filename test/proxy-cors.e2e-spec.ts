// ConfigModule.forRoot() valida el entorno al importar AppModule, así que las
// variables deben fijarse antes de los imports (vi.hoisted se ejecuta primero).
const original = vi.hoisted(() => {
  const overrides: Record<string, string> = {
    TRUST_PROXY: '1',
    CORS_ORIGINS: 'https://app.example.com, https://otro.example.com',
    LOGIN_THROTTLE_LIMIT: '2',
  };
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  return saved;
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Trust proxy y CORS (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
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

  const login = (ip: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'nadie@example.com', password: 'Wrong123' });

  it('con TRUST_PROXY=1 cada IP de X-Forwarded-For tiene su propio contador', async () => {
    await login('203.0.113.1').expect(401);
    await login('203.0.113.1').expect(401);
    await login('203.0.113.1').expect(429);
    // otra IP no se ve afectada
    await login('203.0.113.2').expect(401);
    await login('203.0.113.2').expect(401);
    await login('203.0.113.2').expect(429);
  });

  it('origin permitido recibe Access-Control-Allow-Origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://app.example.com')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-expose-headers']).toContain(
      'Retry-After',
    );
  });

  it('origin no permitido no recibe Access-Control-Allow-Origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://malo.example.com')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight de un origin permitido anuncia los métodos', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/users/me')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'PATCH')
      .expect(204);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
  });
});
