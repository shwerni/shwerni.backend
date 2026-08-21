// packages
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * redirects any http request to https, using the x-forwarded-proto
 * header set by the load balancer since the app itself sits behind it
 */
@Injectable()
export class HttpsRedirectMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const forwardedProto = req.headers['x-forwarded-proto'];

    if (forwardedProto === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }

    next();
  }
}
