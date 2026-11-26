import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  const users = {
    create: vi.fn(),
    findById: vi.fn(),
    findByEmailWithSecrets: vi.fn(),
    findByIdWithSecrets: vi.fn(),
    setRefreshTokenHash: vi.fn(),
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
