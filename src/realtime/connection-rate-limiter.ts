// packages
import { Injectable } from '@nestjs/common';

// guests (website list pages, and connections without a valid token) and members (USER / OWNER)
// are counted apart, so guest page views on a shared ip (carrier nat) never block a consultant
// or an app user behind the same ip
export type RateLimitBucket = 'guest' | 'member';

/**
 * simple in-memory sliding window, rejects ips opening
 * more than the allowed connections per minute, per bucket
 */
@Injectable()
export class ConnectionRateLimiter {
  // member attempts per ip
  private readonly attempts = new Map<string, number[]>();
  // guest attempts per ip, a window of their own
  private readonly guestAttempts = new Map<string, number[]>();
  private readonly WINDOW_MS = 60_000;
  private readonly MAX_ATTEMPTS = 20;
  private readonly MAX_GUEST_ATTEMPTS = 120;
  private lastSweep = 0;

  allow(ip: string, bucket: RateLimitBucket = 'member'): boolean {
    const now = Date.now();
    this.sweep(now);

    const attempts = bucket === 'guest' ? this.guestAttempts : this.attempts;
    const max =
      bucket === 'guest' ? this.MAX_GUEST_ATTEMPTS : this.MAX_ATTEMPTS;

    const recent = (attempts.get(ip) ?? []).filter(
      (t) => now - t < this.WINDOW_MS,
    );

    if (recent.length >= max) return false;

    recent.push(now);
    attempts.set(ip, recent);
    return true;
  }

  // once per window, drops every ip with no attempt inside it, so the maps never grow forever
  private sweep(now: number) {
    if (now - this.lastSweep < this.WINDOW_MS) return;
    this.lastSweep = now;

    for (const attempts of [this.attempts, this.guestAttempts]) {
      for (const [ip, times] of attempts) {
        if (now - times[times.length - 1] >= this.WINDOW_MS)
          attempts.delete(ip);
      }
    }
  }
}
