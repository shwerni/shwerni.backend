// to owner sockets (the consultants' dashboards)
export interface PresenceChangedBroadcast {
  consultantId: string;
  online: boolean;
  onlineCount: number;
  counts: { owners: number; clients: number; guests: number; total: number };
}

// to every other socket: the same event without the live connection counts
export type PublicPresenceChangedBroadcast = Omit<
  PresenceChangedBroadcast,
  'counts'
>;
