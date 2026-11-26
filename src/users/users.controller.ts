import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateMeDto } from './dto/update-me.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiOkResponse({ description: 'Usuario autenticado' })
  @Get('me')
  me(@CurrentUser('sub') id: string) {
    return this.users.findById(id);
  }

  @Patch('me')
  updateMe(@CurrentUser('sub') id: string, @Body() dto: UpdateMeDto) {
    return this.users.update(id, dto);
  }

  @ApiOkResponse({ description: '{ data, total, page, limit }' })
  @ApiForbiddenResponse({ description: 'Requiere rol ADMIN' })
  @Get()
  @Roles(Role.ADMIN)
  findAll(@Query() query: ListUsersQueryDto) {
    return this.users.findAll(query.page, query.limit);
  }

  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @Get(':id')
  @Roles(Role.ADMIN)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findById(id);
  }

  @ApiConflictResponse({ description: 'Email ya registrado' })
  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUser('sub') currentId: string,
  ) {
    if (id === currentId && dto.role !== undefined && dto.role !== Role.ADMIN) {
      throw new BadRequestException(
        'Un administrador no puede quitarse a sí mismo el rol ADMIN',
      );
    }
    return this.users.update(id, dto);
  }

  @Post(':id/unlock')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Cuenta desbloqueada' })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  unlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.unlock(id);
  }

  @ApiNoContentResponse({ description: 'Usuario eliminado' })
  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') currentId: string,
  ) {
    if (id === currentId) {
      throw new BadRequestException(
        'Un administrador no puede eliminarse a sí mismo',
      );
    }
    return this.users.remove(id);
  }
}
