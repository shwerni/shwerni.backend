// packages
import { Injectable } from '@nestjs/common';

/**
 * simple in-memory sliding window, rejects ips opening
 * more than the allowed connections per minute
 */
@Injectable()
export class ConnectionRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly WINDOW_MS = 60_000;
  private readonly MAX_ATTEMPTS = 20;
  private lastSweep = 0;

  allow(ip: string): boolean {
    const now = Date.now();
    this.sweep(now);

    const recent = (this.attempts.get(ip) ?? []).filter(
      (t) => now - t < this.WINDOW_MS,
    );

    if (recent.length >= this.MAX_ATTEMPTS) return false;

    recent.push(now);
    this.attempts.set(ip, recent);
    return true;
  }

  // once per window, drops every ip with no attempt inside it, so the map never grows forever
  private sweep(now: number) {
    if (now - this.lastSweep < this.WINDOW_MS) return;
    this.lastSweep = now;

    for (const [ip, times] of this.attempts) {
      if (now - times[times.length - 1] >= this.WINDOW_MS)
        this.attempts.delete(ip);
    }
  }
}
