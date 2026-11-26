import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { AccountLockedException } from '../exceptions/account-locked.exception.js';

/** Responde 429 con el header Retry-After del bloqueo de cuenta. */
@Catch(AccountLockedException)
export class AccountLockedFilter implements ExceptionFilter {
  catch(exception: AccountLockedException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res
      .status(exception.getStatus())
      .set('Retry-After', String(exception.retryAfterSeconds))
      .json(exception.getResponse());
  }
}
