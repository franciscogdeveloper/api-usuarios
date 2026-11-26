import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  const prisma = {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const config = {
    get: vi.fn((key: string, def: number) =>
      key === 'MAX_LOGIN_ATTEMPTS' ? 3 : def,
    ),
  };
  let service: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UsersService(prisma as never, config as never);
  });

  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });

  it('create hashea el password y no lo devuelve', async () => {
    prisma.user.create.mockImplementation(
      ({ data }: { data: { email: string; name: string } }) =>
        Promise.resolve({ id: 'u1', email: data.email, name: data.name }),
    );
    const res = await service.create({
      email: ' A@B.com ',
      name: 'Ana',
      password: 'Secret123',
    });
    const args = prisma.user.create.mock.calls[0][0];
    expect(args.data.password).not.toBe('Secret123');
    expect(await argon2.verify(args.data.password, 'Secret123')).toBe(true);
    expect(args.data.email).toBe('a@b.com');
    expect(args.select).not.toHaveProperty('password');
    expect(res).not.toHaveProperty('password');
  });

  it('create con P2002 -> 409', async () => {
    prisma.user.create.mockRejectedValue(p2002());
    await expect(
      service.create({ email: 'a@b.com', name: 'Ana', password: 'Secret123' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findById inexistente -> 404', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findById('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update con password limpia refreshTokenHash', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1' });
    await service.update('u1', { password: 'NewSecret1' });
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.refreshTokenHash).toBeNull();
    expect(await argon2.verify(data.password, 'NewSecret1')).toBe(true);
  });

  it('update con password también desbloquea la cuenta', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1' });
    await service.update('u1', { password: 'NewSecret1' });
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.failedLoginAttempts).toBe(0);
    expect(data.lockedUntil).toBeNull();
  });

  it('registerFailedLogin: el intento que alcanza el máximo fija lockedUntil', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({ failedLoginAttempts: 3 });
    const before = Date.now();
    await service.registerFailedLogin('u1');
    const calls = prisma.user.updateMany.mock.calls;
    const lock = calls[calls.length - 1][0];
    expect(lock.where).toEqual({ id: 'u1', lockedUntil: null });
    expect(lock.data.lockedUntil.getTime()).toBeGreaterThanOrEqual(
      before + 15 * 60_000,
    );
  });

  it('registerFailedLogin: por debajo del máximo no bloquea', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    prisma.user.update.mockResolvedValue({ failedLoginAttempts: 2 });
    await service.registerFailedLogin('u1');
    // solo la limpieza de bloqueos expirados
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      failedLoginAttempts: { increment: 1 },
    });
  });

  it('unlock de usuario inexistente -> 404', async () => {
    prisma.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('nf', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    await expect(service.unlock('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update sin password no toca refreshTokenHash', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1' });
    await service.update('u1', { name: 'Nuevo' });
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'refreshTokenHash',
    );
  });
});
