import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export const ENV_DEFAULTS = {
  THROTTLE_LIMIT: 100,
  THROTTLE_TTL_MS: 60000,
  LOGIN_THROTTLE_LIMIT: 5,
  REGISTER_THROTTLE_LIMIT: 3,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 15,
} as const;

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @MinLength(16)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  @MinLength(16)
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number = ENV_DEFAULTS.THROTTLE_LIMIT;

  @IsInt()
  @Min(1)
  THROTTLE_TTL_MS: number = ENV_DEFAULTS.THROTTLE_TTL_MS;

  @IsInt()
  @Min(1)
  LOGIN_THROTTLE_LIMIT: number = ENV_DEFAULTS.LOGIN_THROTTLE_LIMIT;

  @IsInt()
  @Min(1)
  REGISTER_THROTTLE_LIMIT: number = ENV_DEFAULTS.REGISTER_THROTTLE_LIMIT;

  @IsInt()
  @Min(1)
  MAX_LOGIN_ATTEMPTS: number = ENV_DEFAULTS.MAX_LOGIN_ATTEMPTS;

  @IsInt()
  @Min(1)
  LOCKOUT_MINUTES: number = ENV_DEFAULTS.LOCKOUT_MINUTES;

  @IsEmail()
  ADMIN_EMAIL: string;

  @IsString()
  @MinLength(8)
  ADMIN_PASSWORD: string;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment variables:\n${errors.toString()}`);
  }
  return validated;
}
