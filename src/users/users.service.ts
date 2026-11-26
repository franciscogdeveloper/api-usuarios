import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminUpdateUserDto } from './dto/admin-update-user.dto.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import { publicUserSelect, type PublicUser } from './user.select.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(
    dto: CreateUserDto,
    role: Role = Role.USER,
  ): Promise<PublicUser> {
    const password = await argon2.hash(dto.password);
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          name: dto.name,
          password,
          role,
        },
        select: publicUserSelect,
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async findAll(page: number, limit: number) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        select: publicUserSelect,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count(),
    ]);
    return { data, total, page, limit };
  }

  async findById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  /** Internal use only (auth): includes password and refreshTokenHash. */
  findByEmailWithSecrets(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }

  /** Internal use only (auth). */
  findByIdWithSecrets(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async update(
    id: string,
    dto: Partial<AdminUpdateUserDto>,
  ): Promise<PublicUser> {
    const { password, email, ...rest } = dto;
    const data: Prisma.UserUpdateInput = { ...rest };
    if (email !== undefined) data.email = email.trim().toLowerCase();
    if (password !== undefined) {
      data.password = await argon2.hash(password);
      // Cambiar el password cierra las sesiones activas.
      data.refreshTokenHash = null;
      // Un cambio de password también desbloquea la cuenta.
      data.failedLoginAttempts = 0;
      data.lockedUntil = null;
    }
    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: publicUserSelect,
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async setRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash: hash },
    });
  }

  /**
   * Registra un fallo de login de forma atómica. Un bloqueo ya expirado se
   * considera desbloqueado: el contador reinicia antes de incrementar.
   */
  async registerFailedLogin(id: string): Promise<void> {
    const max = this.config.get<number>('MAX_LOGIN_ATTEMPTS', 5);
    const minutes = this.config.get<number>('LOCKOUT_MINUTES', 15);
    const now = new Date();
    await this.prisma.user.updateMany({
      where: { id, lockedUntil: { lte: now } },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (failedLoginAttempts >= max) {
      await this.prisma.user.updateMany({
        where: { id, lockedUntil: null },
        data: { lockedUntil: new Date(now.getTime() + minutes * 60_000) },
      });
    }
  }

  async resetLoginAttempts(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  async unlock(id: string): Promise<void> {
    try {
      await this.resetLoginAttempts(id);
    } catch (e) {
      throw this.mapError(e);
    }
  }

  private mapError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return new ConflictException('El email ya está registrado');
      }
      if (e.code === 'P2025') {
        return new NotFoundException('Usuario no encontrado');
      }
    }
    return e;
  }
}
