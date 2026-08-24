export interface PresenceChangedBroadcast {
  consultantId: string;
  online: boolean;
  onlineCount: number;
  counts: { owners: number; clients: number; guests: number; total: number };
}
