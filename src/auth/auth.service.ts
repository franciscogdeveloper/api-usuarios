import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { JwtPayload } from '../common/types/jwt-payload.js';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

type ExpiresIn = NonNullable<
  Parameters<JwtService['signAsync']>[1]
>['expiresIn'];

@Injectable()
export class AuthService {
  /** Hash dummy precalculado para igualar tiempos cuando el usuario no existe. */
  private readonly dummyHash = argon2.hash('dummy-password-for-timing');

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: CreateUserDto) {
    const user = await this.users.create(dto, Role.USER);
    const tokens = await this.issueTokens(user);
    return { ...tokens, user };
  }

  async login(dto: LoginDto) {
    const found = await this.users.findByEmailWithSecrets(dto.email);
    const valid = await argon2.verify(
      found?.password ?? (await this.dummyHash),
      dto.password,
    );
    if (!found || !valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const tokens = await this.issueTokens(found);
    const user = await this.users.findById(found.id);
    return { ...tokens, user };
  }

  async refresh(payload: JwtPayload, refreshToken: string): Promise<Tokens> {
    const user = await this.users.findByIdWithSecrets(payload.sub);
    if (
      !user?.refreshTokenHash ||
      !(await argon2.verify(user.refreshTokenHash, refreshToken))
    ) {
      throw new UnauthorizedException('Refresh token inválido');
    }
    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.users.setRefreshTokenHash(userId, null);
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    role: Role;
  }): Promise<Tokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as ExpiresIn,
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'JWT_REFRESH_EXPIRES_IN',
        ) as ExpiresIn,
        jwtid: randomUUID(),
      }),
    ]);
    await this.users.setRefreshTokenHash(
      user.id,
      await argon2.hash(refreshToken),
    );
    return { accessToken, refreshToken };
  }
}
