export interface SocketData {
  userId: string;
  role: 'USER' | 'OWNER' | 'GUEST';
  isOnlineConsultant?: boolean;
  // "app": the app's one shared socket (chat, peer presence), kept out of the instant flow
  purpose?: 'app';
  // a consultant's app socket: the peer key its presence is announced under
  peerKey?: string;
  // epoch ms of the last packet received on an app socket (a killed app: its last pong)
  lastActiveAt?: number;
  // the chats this socket joined with a peer: mid → the peer key it watches
  chatPeers?: Record<string, string>;
}
