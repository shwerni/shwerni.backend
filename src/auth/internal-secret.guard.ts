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
    const provided = request.headers['x-internal-secret'] as string | undefined;
    const expected = process.env.INTERNAL_SHARED_SECRET;

    if (!provided || provided.length !== expected.length) {
      throw new UnauthorizedException();
    }

    const isValid = timingSafeEqual(
      Buffer.from(provided),
      Buffer.from(expected),
    );
    if (!isValid) throw new UnauthorizedException();

    return true;
  }
}
