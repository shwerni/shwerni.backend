// packages
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const ALLOWED_HOST = 'realtime.shwerni.sa';

/**
 * blocks direct access via the raw alb hostname and forces https
 * on the custom domain, since ssl terminates at the load balancer
 */
@Injectable()
export class HttpsRedirectMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const host = req.headers.host;

    if (host && host.includes('elb.amazonaws.com')) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    if (forwardedProto === 'http') {
      res.redirect(301, `https://${ALLOWED_HOST}${req.originalUrl}`);
      return;
    }

    next();
  }
}
