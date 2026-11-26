import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health sin token -> 200 { status: ok, db: up }', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /api/health no se limita por throttling', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/api/health').expect(200);
    }
  });

  it('GET /api/health con la base caída -> 503', async () => {
    const prisma = app.get(PrismaService);
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('db down'));
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(503);
    expect(res.body).toMatchObject({ status: 'error', db: 'down' });
    spy.mockRestore();
  });
});
