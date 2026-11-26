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
    },
  };
  let service: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UsersService(prisma as never);
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

  it('update sin password no toca refreshTokenHash', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1' });
    await service.update('u1', { name: 'Nuevo' });
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'refreshTokenHash',
    );
  });
});
