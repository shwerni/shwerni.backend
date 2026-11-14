// packages
import { Injectable } from '@nestjs/common';

// a last seen older than this is dropped (the app then falls back to UserPresence)
const LAST_SEEN_KEEP_MS = 7 * 86_400_000;
const PRUNE_EVERY_MS = 3_600_000;

export interface PeerState {
  online: boolean;
  // epoch ms of the last packet from the last app socket, null when unknown
  lastSeenAt: number | null;
}

/**
 * which consultants have the app open, by peer key (never a user id): a count of open app
 * sockets per key, and the last seen time once the count drops to 0. in memory: lost on a
 * restart, when the join ticket's UserPresence time takes over
 */
@Injectable()
export class AppPresenceService {
  private readonly open = new Map<string, number>();
  private readonly lastSeen = new Map<string, number>();
  private lastPrune = 0;

  // returns true only when this is the key's first open app socket
  connect(key: string): boolean {
    const current = this.open.get(key) ?? 0;
    this.open.set(key, current + 1);
    return current === 0;
  }

  /**
   * one app socket of the key closed
   * @param lastActiveAt the last packet received from it (a killed app: its last pong)
   * @returns true only when it was the key's last open app socket
   */
  disconnect(key: string, lastActiveAt: number, now = Date.now()): boolean {
    const current = this.open.get(key) ?? 0;
    if (current > 1) {
      this.open.set(key, current - 1);
      return false;
    }

    this.open.delete(key);
    this.lastSeen.set(key, lastActiveAt);
    this.prune(now);
    return current === 1;
  }

  state(key: string): PeerState {
    return {
      online: this.open.has(key),
      lastSeenAt: this.lastSeen.get(key) ?? null,
    };
  }

  // at most once an hour: drops last seen times older than 7 days
  private prune(now: number) {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;

    for (const [key, at] of this.lastSeen) {
      if (now - at > LAST_SEEN_KEEP_MS) this.lastSeen.delete(key);
    }
  }
}
