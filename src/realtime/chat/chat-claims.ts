// types
import type { SocketData } from '../types/socket-data.js';

// a meeting id (nanoid alphabet), as next.js's Meeting.mid
export const MID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export type ChatSide = 'USER' | 'OWNER';

// what a valid join ticket lets this socket do
export interface ChatJoin {
  mid: string;
  side: ChatSide;
}

// the side's room: one per meeting and per side, so each side gets its own view of a message
export const chatRoom = (mid: string, side: ChatSide) => `chat:${mid}:${side}`;

/**
 * checks a verified join ticket (signature, audience, issuer and age already checked by
 * verifyChatTicket) against the socket that sent it. kept apart from the jose call so it can be
 * tested without jose
 * - the socket is the app's shared one (auth.purpose "app"), signed in as USER or OWNER
 * - the ticket is this user's (sub), for this socket's role (side), and for the meeting asked
 * @param claims the verified ticket's payload
 * @param socket the socket's data (set when its connection token was verified)
 * @param mid the meeting the socket asked to join
 * @returns the join, or null when anything doesn't match
 */
export function toChatJoin(
  claims: Record<string, unknown>,
  socket: Partial<SocketData>,
  mid: unknown,
): ChatJoin | null {
  if (socket.purpose !== 'app' || typeof socket.userId !== 'string')
    return null;
  if (socket.role !== 'USER' && socket.role !== 'OWNER') return null;

  if (typeof mid !== 'string' || !MID_PATTERN.test(mid)) return null;
  if (claims.mid !== mid) return null;
  if (claims.sub !== socket.userId) return null;
  if (claims.side !== socket.role) return null;

  return { mid, side: socket.role };
}
