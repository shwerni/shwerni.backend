// packages
import { Injectable } from '@nestjs/common';

/**
 * simple in-memory sliding windows of connection attempts per minute:
 * - guests (website list pages, and connections without a valid token): per ip
 * - members (USER / OWNER, token verified): per user, so app users behind one carrier ip (cgnat)
 *   never share a limit, plus a high per-ip ceiling for members so one ip can't open member
 *   connections without end
 * guests and members never use up each other's windows
 */
@Injectable()
export class ConnectionRateLimiter {
  // guest attempts per ip
  private readonly guestAttempts = new Map<string, number[]>();
  // member attempts per user id
  private readonly memberAttempts = new Map<string, number[]>();
  // member attempts per ip, for the ceiling
  private readonly memberIpAttempts = new Map<string, number[]>();
  private readonly WINDOW_MS = 60_000;
  private readonly MAX_GUEST_ATTEMPTS = 120;
  private readonly MAX_MEMBER_ATTEMPTS = 20;
  private readonly MAX_MEMBER_IP_ATTEMPTS = 300;
  private lastSweep = 0;

  allowGuest(ip: string): boolean {
    const now = Date.now();
    this.sweep(now);

    const byIp = this.recent(this.guestAttempts, ip, now);
    if (byIp.length >= this.MAX_GUEST_ATTEMPTS) return false;

    byIp.push(now);
    this.guestAttempts.set(ip, byIp);
    return true;
  }

  // nothing is counted when either window is full
  allowMember(userId: string, ip: string): boolean {
    const now = Date.now();
    this.sweep(now);

    const byUser = this.recent(this.memberAttempts, userId, now);
    const byIp = this.recent(this.memberIpAttempts, ip, now);
    if (
      byUser.length >= this.MAX_MEMBER_ATTEMPTS ||
      byIp.length >= this.MAX_MEMBER_IP_ATTEMPTS
    )
      return false;

    byUser.push(now);
    byIp.push(now);
    this.memberAttempts.set(userId, byUser);
    this.memberIpAttempts.set(ip, byIp);
    return true;
  }

  private recent(attempts: Map<string, number[]>, key: string, now: number) {
    return (attempts.get(key) ?? []).filter((t) => now - t < this.WINDOW_MS);
  }

  // once per window, drops every key with no attempt inside it, so the maps never grow forever
  private sweep(now: number) {
    if (now - this.lastSweep < this.WINDOW_MS) return;
    this.lastSweep = now;

    for (const attempts of [
      this.guestAttempts,
      this.memberAttempts,
      this.memberIpAttempts,
    ]) {
      for (const [key, times] of attempts) {
        if (now - times[times.length - 1] >= this.WINDOW_MS)
          attempts.delete(key);
      }
    }
  }
}
