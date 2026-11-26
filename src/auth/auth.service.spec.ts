import { HttpException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';

vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

describe('AuthService', () => {
  const users = {
    create: vi.fn(),
    findById: vi.fn(),
    findByEmailWithSecrets: vi.fn(),
    findByIdWithSecrets: vi.fn(),
    setRefreshTokenHash: vi.fn(),
    registerFailedLogin: vi.fn(),
    resetLoginAttempts: vi.fn(),
  };
  const jwt = { signAsync: vi.fn() };
  const config = { getOrThrow: vi.fn((k: string) => `value-${k}`) };
  let service: AuthService;
  let passwordHash: string;
  const payload = { sub: 'u1', email: 'a@b.com', role: 'USER' as const };

  beforeAll(async () => {
    passwordHash = await argon2.hash('Secret123');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    jwt.signAsync
      .mockResolvedValueOnce('access')
      .mockResolvedValueOnce('refresh');
    service = new AuthService(users as never, jwt as never, config as never);
  });

  const dbUser = () => ({
    id: 'u1',
    email: 'a@b.com',
    name: 'A',
    role: 'USER',
    password: passwordHash,
    refreshTokenHash: null,
    failedLoginAttempts: 0,
    lockedUntil: null as Date | null,
  });

  it('login correcto devuelve tokens y guarda el hash del refresh', async () => {
    users.findByEmailWithSecrets.mockResolvedValue(dbUser());
    users.findById.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    const res = await service.login({
      email: 'a@b.com',
      password: 'Secret123',
    });
    expect(res.accessToken).toBe('access');
    expect(res.refreshToken).toBe('refresh');
    expect(res.user).not.toHaveProperty('password');
    expect(users.setRefreshTokenHash).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
    );
  });

  it('login con usuario inexistente -> 401', async () => {
    users.findByEmailWithSecrets.mockResolvedValue(null);
    await expect(
      service.login({ email: 'x@b.com', password: 'Secret123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login con password malo -> 401', async () => {
    users.findByEmailWithSecrets.mockResolvedValue(dbUser());
    await expect(
      service.login({ email: 'a@b.com', password: 'Wrong123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login fallido llama a registerFailedLogin', async () => {
    users.findByEmailWithSecrets.mockResolvedValue(dbUser());
    await expect(
      service.login({ email: 'a@b.com', password: 'Wrong123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.registerFailedLogin).toHaveBeenCalledWith('u1');
    expect(users.resetLoginAttempts).not.toHaveBeenCalled();
  });

  it('login con usuario inexistente no registra fallos', async () => {
    users.findByEmailWithSecrets.mockResolvedValue(null);
    await expect(
      service.login({ email: 'x@b.com', password: 'Secret123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.registerFailedLogin).not.toHaveBeenCalled();
  });

  it('login correcto llama a resetLoginAttempts', async () => {
    users.findByEmailWithSecrets.mockResolvedValue(dbUser());
    users.findById.mockResolvedValue({ id: 'u1' });
    await service.login({ email: 'a@b.com', password: 'Secret123' });
    expect(users.resetLoginAttempts).toHaveBeenCalledWith('u1');
  });

  it('cuenta bloqueada -> 429 sin verificar el password', async () => {
    users.findByEmailWithSecrets.mockResolvedValue({
      ...dbUser(),
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const verify = vi.mocked(argon2.verify);
    verify.mockClear();
    const err = await service
      .login({ email: 'a@b.com', password: 'Secret123' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(verify).not.toHaveBeenCalled();
    expect(users.registerFailedLogin).not.toHaveBeenCalled();
  });

  it('bloqueo expirado permite el login', async () => {
    users.findByEmailWithSecrets.mockResolvedValue({
      ...dbUser(),
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() - 1000),
    });
    users.findById.mockResolvedValue({ id: 'u1' });
    const res = await service.login({
      email: 'a@b.com',
      password: 'Secret123',
    });
    expect(res.accessToken).toBe('access');
    expect(users.resetLoginAttempts).toHaveBeenCalledWith('u1');
  });

  it('refresh con hash que no coincide -> 401', async () => {
    users.findByIdWithSecrets.mockResolvedValue({
      ...dbUser(),
      refreshTokenHash: await argon2.hash('otro-token'),
    });
    await expect(service.refresh(payload, 'tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.setRefreshTokenHash).not.toHaveBeenCalled();
  });

  it('refresh con hash null -> 401', async () => {
    users.findByIdWithSecrets.mockResolvedValue(dbUser());
    await expect(service.refresh(payload, 'tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refresh correcto rota y llama a setRefreshTokenHash', async () => {
    users.findByIdWithSecrets.mockResolvedValue({
      ...dbUser(),
      refreshTokenHash: await argon2.hash('old-refresh'),
    });
    const tokens = await service.refresh(payload, 'old-refresh');
    expect(tokens).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(users.setRefreshTokenHash).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
    );
  });

  it('logout pone el hash en null', async () => {
    await service.logout('u1');
    expect(users.setRefreshTokenHash).toHaveBeenCalledWith('u1', null);
  });
});
