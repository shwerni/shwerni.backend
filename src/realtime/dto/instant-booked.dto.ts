// sent to user:{consultantId} once an instant order is paid (next.js → POST /internal/consultant-busy)
export interface InstantBookedBroadcast {
  orderId: number;
  meetingId: string;
  // the consultant's own meeting url (the owner participant)
  meetingUrl: string;
  // meeting start, iso
  startsAt: string;
  // minutes
  duration: number;
  // epoch ms: consultant-online is refused until then
  busyUntil: number;
}

// sent to the socket whose consultant-online was refused while busy
export interface InstantBusyBroadcast {
  orderId: number;
  busyUntil: number;
}

export type ConsultantBusyRequest = InstantBookedBroadcast & {
  consultantId: string;
};
