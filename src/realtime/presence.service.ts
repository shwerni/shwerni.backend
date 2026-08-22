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
}
