import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { JwtRefreshPayload } from '../common/types/jwt-payload.js';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @ApiCreatedResponse({
    description: 'Usuario creado; devuelve tokens y usuario público',
  })
  @Post('register')
  register(@Body() dto: CreateUserDto) {
    return this.auth.register(dto);
  }

  @Public()
  @ApiOkResponse({ description: 'Tokens y usuario público' })
  @ApiUnauthorizedResponse({ description: 'Credenciales inválidas' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @ApiOkResponse({
    description: 'Nuevo par de tokens (el refresh anterior se invalida)',
  })
  @ApiUnauthorizedResponse({ description: 'Refresh token inválido o revocado' })
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@CurrentUser() user: JwtRefreshPayload, @Body() _dto: RefreshDto) {
    return this.auth.refresh(user, user.refreshToken);
  }

  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Sesión cerrada' })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser('sub') userId: string) {
    return this.auth.logout(userId);
  }
}
