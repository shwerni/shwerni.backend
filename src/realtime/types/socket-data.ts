export interface SocketData {
  userId: string;
  role: 'USER' | 'OWNER' | 'GUEST';
  isOnlineConsultant?: boolean;
}
