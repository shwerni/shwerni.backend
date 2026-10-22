// packages
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * guards internal http endpoints only next.js is allowed to call,
 * mirrors the x-app-secret pattern already used for /api/mobile
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-internal-secret'];
    const expected = process.env.INTERNAL_SHARED_SECRET;

    // an unset secret or a missing / malformed header is a 401, never a 500
    if (!expected || typeof provided !== 'string' || !provided) {
      throw new UnauthorizedException();
    }

    // timingSafeEqual throws on different lengths, and those are bytes, not characters
    const providedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    if (
      providedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(providedBytes, expectedBytes)
    ) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
