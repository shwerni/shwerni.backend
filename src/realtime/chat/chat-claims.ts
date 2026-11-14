// utils
import { PEER_KEY_PATTERN } from './peer-key.js';

// types
import type { SocketData } from '../types/socket-data.js';

// a meeting id (nanoid alphabet), as next.js's Meeting.mid
export const MID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export type ChatSide = 'USER' | 'OWNER';

// the consultant a client's ticket lets it watch: their peer key, and their
// UserPresence.lastSeenAt (epoch ms) when next.js minted the ticket
export interface ChatPeerClaim {
  key: string;
  lastSeenAt: number | null;
}

// what a valid join ticket lets this socket do
export interface ChatJoin {
  mid: string;
  side: ChatSide;
  peer: ChatPeerClaim | null;
}

// a ticket's UserPresence time can't be later than this past the server's now
const LAST_SEEN_SKEW_MS = 60_000;

/**
 * the ticket's peer claims, or null when it has none or they're malformed (the chat still
 * works without the header line)
 */
function toPeerClaim(
  claims: Record<string, unknown>,
  now: number,
): ChatPeerClaim | null {
  const { peer, peerLastSeenAt } = claims;
  if (typeof peer !== 'string' || !PEER_KEY_PATTERN.test(peer)) return null;

  const lastSeenAt =
    typeof peerLastSeenAt === 'number' &&
    Number.isFinite(peerLastSeenAt) &&
    peerLastSeenAt > 0 &&
    peerLastSeenAt <= now + LAST_SEEN_SKEW_MS
      ? peerLastSeenAt
      : null;

  return { key: peer, lastSeenAt };
}

// the side's room: one per meeting and per side, so each side gets its own view of a message
export const chatRoom = (mid: string, side: ChatSide) => `chat:${mid}:${side}`;

/**
 * checks a verified join ticket (signature, audience, issuer and age already checked by
 * verifyChatTicket) against the socket that sent it. kept apart from the jose call so it can be
 * tested without jose
 * - the socket is the app's shared one (auth.purpose "app"), signed in as USER or OWNER
 * - the ticket is this user's (sub), for this socket's role (side), and for the meeting asked
 * - only a client watches its peer: an OWNER ticket's peer claims are ignored, so a consultant
 *   never learns a client's status (decision D4)
 * @param claims the verified ticket's payload
 * @param socket the socket's data (set when its connection token was verified)
 * @param mid the meeting the socket asked to join
 * @param now the current time in ms
 * @returns the join, or null when anything doesn't match
 */
export function toChatJoin(
  claims: Record<string, unknown>,
  socket: Partial<SocketData>,
  mid: unknown,
  now = Date.now(),
): ChatJoin | null {
  if (socket.purpose !== 'app' || typeof socket.userId !== 'string')
    return null;
  if (socket.role !== 'USER' && socket.role !== 'OWNER') return null;

  if (typeof mid !== 'string' || !MID_PATTERN.test(mid)) return null;
  if (claims.mid !== mid) return null;
  if (claims.sub !== socket.userId) return null;
  if (claims.side !== socket.role) return null;

  const peer = socket.role === 'USER' ? toPeerClaim(claims, now) : null;
  return { mid, side: socket.role, peer };
}
