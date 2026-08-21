// packages
import { Injectable, Logger } from '@nestjs/common';

/**
 * tracks in-flight instant requests and auto-expires them
 * single-instance in-memory map is fine at current scale;
 * move to redis ttl keys if the gateway ever runs more than one replica
 */
@Injectable()
export class InstantRequestService {
  private readonly logger = new Logger(InstantRequestService.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();

  track(orderId: string, timeoutMs: number, onExpire: () => void) {
    const timer = setTimeout(() => {
      this.pending.delete(orderId);
      onExpire();
    }, timeoutMs);

    this.pending.set(orderId, timer);
  }

  resolve(orderId: string) {
    const timer = this.pending.get(orderId);
    if (!timer) return false;

    clearTimeout(timer);
    this.pending.delete(orderId);
    return true;
  }
}
