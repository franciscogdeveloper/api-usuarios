import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('API Usuarios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  const ADMIN = { email: 'admin@example.com', password: 'Admin123!' };
  const ANA = { email: 'ana@example.com', name: 'Ana', password: 'Secret123' };

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toContain('_test');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.user.create({
      data: {
        email: ADMIN.email,
        name: 'Admin',
        role: Role.ADMIN,
        password: await argon2.hash(ADMIN.password),
      },
    });
  });

  const register = (body = ANA) => http().post('/api/auth/register').send(body);
  const login = (body: { email: string; password: string }) =>
    http().post('/api/auth/login').send(body);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('auth', () => {
    it('register -> 201 con tokens y usuario sin secretos', async () => {
      const res = await register().expect(201);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.user.email).toBe(ANA.email);
      expect(res.body.user.role).toBe('USER');
      expect(res.body.user).not.toHaveProperty('password');
      expect(res.body.user).not.toHaveProperty('refreshTokenHash');
    });

    it('register normaliza el email y rechaza duplicados -> 409', async () => {
      await register({ ...ANA, email: '  Ana@Example.COM ' }).expect(201);
      await register().expect(409);
    });

    it('register valida password y campos extra -> 400', async () => {
      await register({ ...ANA, password: 'weakpass' }).expect(400);
      await http()
        .post('/api/auth/register')
        .send({ ...ANA, role: 'ADMIN' })
        .expect(400);
    });

    it('login con password erróneo o usuario inexistente -> 401 genérico', async () => {
      await register();
      const bad = await login({
        email: ANA.email,
        password: 'Wrong123',
      }).expect(401);
      const none = await login({
        email: 'nadie@example.com',
        password: 'Wrong123',
      }).expect(401);
      expect(bad.body.message).toBe('Credenciales inválidas');
      expect(none.body.message).toBe('Credenciales inválidas');
    });

    it('login -> 200', async () => {
      await register();
      const res = await login({
        email: ANA.email,
        password: ANA.password,
      }).expect(200);
      expect(res.body.accessToken).toBeTruthy();
    });

    it('refresh rota el token y el viejo deja de servir', async () => {
      const { body } = await register();
      const r1 = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(200);
      expect(r1.body.refreshToken).not.toBe(body.refreshToken);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: r1.body.refreshToken })
        .expect(200);
    });

    it('refresh sin token válido -> 401', async () => {
      await http().post('/api/auth/refresh').send({}).expect(401);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: 'basura' })
        .expect(401);
    });

    it('logout -> 204 y luego refresh -> 401', async () => {
      const { body } = await register();
      await http()
        .post('/api/auth/logout')
        .set(auth(body.accessToken))
        .expect(204);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
    });

    it('logout sin token -> 401', async () => {
      await http().post('/api/auth/logout').expect(401);
    });
  });

  describe('users', () => {
    it('sin token -> 401', async () => {
      await http().get('/api/users/me').expect(401);
    });

    it('GET /users/me -> 200 sin password', async () => {
      const { body } = await register();
      const res = await http()
        .get('/api/users/me')
        .set(auth(body.accessToken))
        .expect(200);
      expect(res.body.email).toBe(ANA.email);
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('refreshTokenHash');
    });

    it('USER no puede listar -> 403; ADMIN sí -> 200 paginado', async () => {
      const { body } = await register();
      await http().get('/api/users').set(auth(body.accessToken)).expect(403);
      const adm = await login(ADMIN).expect(200);
      const res = await http()
        .get('/api/users?limit=1')
        .set(auth(adm.body.accessToken))
        .expect(200);
      expect(res.body).toMatchObject({ total: 2, page: 1, limit: 1 });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).not.toHaveProperty('password');
      await http()
        .get('/api/users?limit=200')
        .set(auth(adm.body.accessToken))
        .expect(400);
    });

    it('ADMIN: GET/PATCH/DELETE /users/:id, UUID inválido y 404', async () => {
      const reg = await register();
      const adm = await login(ADMIN);
      const t = auth(adm.body.accessToken);
      const id = reg.body.user.id;
      await http().get(`/api/users/${id}`).set(t).expect(200);
      await http().get('/api/users/abc').set(t).expect(400);
      await http()
        .get('/api/users/00000000-0000-4000-8000-000000000000')
        .set(t)
        .expect(404);
      const up = await http()
        .patch(`/api/users/${id}`)
        .set(t)
        .send({ role: 'ADMIN', name: 'Ana B' })
        .expect(200);
      expect(up.body.role).toBe('ADMIN');
      await http().delete(`/api/users/${id}`).set(t).expect(204);
      await http().delete(`/api/users/${id}`).set(t).expect(404);
    });

    it('PATCH /users/:id con email duplicado -> 409', async () => {
      const reg = await register();
      const adm = await login(ADMIN);
      await http()
        .patch(`/api/users/${reg.body.user.id}`)
        .set(auth(adm.body.accessToken))
        .send({ email: ADMIN.email })
        .expect(409);
    });

    it('PATCH /users/me actualiza el nombre', async () => {
      const { body } = await register();
      const res = await http()
        .patch('/api/users/me')
        .set(auth(body.accessToken))
        .send({ name: 'Ana Nueva' })
        .expect(200);
      expect(res.body.name).toBe('Ana Nueva');
    });
  });

  describe('ajustes de seguridad', () => {
    it('cambiar password por /users/me cierra las sesiones', async () => {
      const { body } = await register();
      await http()
        .patch('/api/users/me')
        .set(auth(body.accessToken))
        .send({ password: 'NewSecret1' })
        .expect(200);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
      await login({ email: ANA.email, password: 'NewSecret1' }).expect(200);
      await login({ email: ANA.email, password: ANA.password }).expect(401);
    });

    it('cambiar password por /users/:id cierra las sesiones', async () => {
      const { body } = await register();
      const adm = await login(ADMIN);
      await http()
        .patch(`/api/users/${body.user.id}`)
        .set(auth(adm.body.accessToken))
        .send({ password: 'NewSecret1' })
        .expect(200);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
    });

    it('admin no puede borrarse ni quitarse el rol ADMIN -> 400', async () => {
      const adm = await login(ADMIN);
      const t = auth(adm.body.accessToken);
      const id = adm.body.user.id;
      const del = await http().delete(`/api/users/${id}`).set(t).expect(400);
      expect(del.body.message).toMatch(/eliminarse/);
      const demote = await http()
        .patch(`/api/users/${id}`)
        .set(t)
        .send({ role: 'USER' })
        .expect(400);
      expect(demote.body.message).toMatch(/rol ADMIN/);
      await http()
        .patch(`/api/users/${id}`)
        .set(t)
        .send({ name: 'Root' })
        .expect(200);
    });
  });

  describe('bloqueo de cuenta', () => {
    it('5 fallos bloquean: login correcto -> 429 con Retry-After; unlock -> 204', async () => {
      const reg = await register();
      for (let i = 0; i < 5; i++) {
        await login({ email: ANA.email, password: 'Wrong123' }).expect(401);
      }
      const locked = await login({
        email: ANA.email,
        password: ANA.password,
      }).expect(429);
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
      expect(locked.body.message).toBe(
        'Cuenta bloqueada temporalmente. Intenta más tarde.',
      );

      await http()
        .post('/api/users/' + reg.body.user.id + '/unlock')
        .set(auth(reg.body.accessToken))
        .expect(403);
      const adm = await login(ADMIN);
      await http()
        .post('/api/users/' + reg.body.user.id + '/unlock')
        .set(auth(adm.body.accessToken))
        .expect(204);
      await login({ email: ANA.email, password: ANA.password }).expect(200);
    });

    it('unlock: UUID inválido -> 400, inexistente -> 404', async () => {
      const adm = await login(ADMIN);
      const t = auth(adm.body.accessToken);
      await http().post('/api/users/abc/unlock').set(t).expect(400);
      await http()
        .post('/api/users/00000000-0000-4000-8000-000000000000/unlock')
        .set(t)
        .expect(404);
    });

    it('un login correcto reinicia el contador', async () => {
      await register();
      for (let i = 0; i < 4; i++) {
        await login({ email: ANA.email, password: 'Wrong123' }).expect(401);
      }
      await login({ email: ANA.email, password: ANA.password }).expect(200);
      for (let i = 0; i < 4; i++) {
        await login({ email: ANA.email, password: 'Wrong123' }).expect(401);
      }
      await login({ email: ANA.email, password: ANA.password }).expect(200);
    });

    it('un bloqueo expirado da otra vez los intentos completos', async () => {
      await register();
      for (let i = 0; i < 5; i++) {
        await login({ email: ANA.email, password: 'Wrong123' }).expect(401);
      }
      await prisma.user.update({
        where: { email: ANA.email },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      for (let i = 0; i < 4; i++) {
        await login({ email: ANA.email, password: 'Wrong123' }).expect(401);
      }
      await login({ email: ANA.email, password: ANA.password }).expect(200);
    });

    it('cambio de password por admin desbloquea al usuario', async () => {
      const reg = await register();
      for (let i = 0; i < 5; i++) {
        await login({ email: ANA.email, password: 'Wrong123' }).expect(401);
      }
      const adm = await login(ADMIN);
      await http()
        .patch('/api/users/' + reg.body.user.id)
        .set(auth(adm.body.accessToken))
        .send({ password: 'NewSecret1' })
        .expect(200);
      await login({ email: ANA.email, password: 'NewSecret1' }).expect(200);
    });

    it('la respuesta pública no expone campos de bloqueo', async () => {
      const { body } = await register();
      expect(body.user).not.toHaveProperty('failedLoginAttempts');
      expect(body.user).not.toHaveProperty('lockedUntil');
    });
  });

  describe('docs', () => {
    it('GET /docs y /docs-json -> 200', async () => {
      await http().get('/docs').expect(200);
      const res = await http().get('/docs-json').expect(200);
      expect(res.body.info.title).toBe('API Usuarios');
    });
  });
});
