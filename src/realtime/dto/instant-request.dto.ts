export interface InstantRequestBroadcast {
  orderId: string;
  consultantId: string;
  clientId: string;
  clientName: string;
  expiresAt: number;
}

export interface InstantResponseBroadcast {
  orderId: string;
  clientId: string;
  accepted: boolean;
}
