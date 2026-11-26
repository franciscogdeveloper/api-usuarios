import { ENV_DEFAULTS } from '../config/env.validation.js';

/**
 * Los decoradores se evalúan al importar el módulo, antes de que ConfigModule
 * cargue .env, así que el límite se resuelve de forma perezosa en cada request
 * (@nestjs/throttler v6 acepta funciones en `limit` y `ttl`).
 */
export const envInt =
  (name: 'LOGIN_THROTTLE_LIMIT' | 'REGISTER_THROTTLE_LIMIT') => (): number => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : ENV_DEFAULTS[name];
  };
