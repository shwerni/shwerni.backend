// packages
import { Injectable } from '@nestjs/common';

/**
 * tracks online consultants in memory using a reference count per id,
 * so a consultant with multiple open connections only goes offline
 * once every connection has closed
 */
@Injectable()
export class PresenceService {
  private readonly onlineCounts = new Map<string, number>();
  // consultants with a paid instant session, blocked from going online until busyUntil
  private readonly busy = new Map<
    string,
    { orderId: number; busyUntil: number }
  >();

  // returns true only when this is the consultant's first active connection
  markOnline(consultantId: string): boolean {
    const current = this.onlineCounts.get(consultantId) ?? 0;
    this.onlineCounts.set(consultantId, current + 1);
    return current === 0;
  }

  // returns true only when this was the consultant's last active connection
  markOffline(consultantId: string): boolean {
    const current = this.onlineCounts.get(consultantId) ?? 0;

    if (current <= 1) {
      this.onlineCounts.delete(consultantId);
      return true;
    }

    this.onlineCounts.set(consultantId, current - 1);
    return false;
  }

  isOnline(consultantId: string): boolean {
    return this.onlineCounts.has(consultantId);
  }

  getOnlineIds(): string[] {
    return Array.from(this.onlineCounts.keys());
  }

  // drops every connection reference at once, returns true if the consultant was online
  clear(consultantId: string): boolean {
    return this.onlineCounts.delete(consultantId);
  }

  // a later booking replaces the block
  setBusy(consultantId: string, orderId: number, busyUntil: number) {
    this.busy.set(consultantId, { orderId, busyUntil });
  }

  // the active block, an expired one is dropped on read
  getBusy(consultantId: string): { orderId: number; busyUntil: number } | null {
    const entry = this.busy.get(consultantId);
    if (!entry) return null;

    if (entry.busyUntil <= Date.now()) {
      this.busy.delete(consultantId);
      return null;
    }

    return entry;
  }
}
