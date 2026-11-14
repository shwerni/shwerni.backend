export interface SocketData {
  userId: string;
  role: 'USER' | 'OWNER' | 'GUEST';
  isOnlineConsultant?: boolean;
  // "app": the app's one shared socket (chat, peer presence), kept out of the instant flow
  purpose?: 'app';
}
