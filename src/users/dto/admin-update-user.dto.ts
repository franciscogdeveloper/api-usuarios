import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { normalizeEmail } from './create-user.dto.js';
import { UpdateMeDto } from './update-me.dto.js';

export class AdminUpdateUserDto extends UpdateMeDto {
  @ApiPropertyOptional({ example: 'ana@example.com' })
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
