// React & Expo — n/a, nest imports below

// packages
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "crypto";

/**
 * guards internal http endpoints only next.js is allowed to call,
 * mirrors the x-app-secret pattern already used for /api/mobile
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided: string | undefined = request.headers["x-internal-secret"];
    const expected = process.env.INTERNAL_SHARED_SECRET!;

    if (!provided || provided.length !== expected.length) {
      throw new UnauthorizedException();
    }

    const isValid = timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!isValid) throw new UnauthorizedException();

    return true;
  }
}