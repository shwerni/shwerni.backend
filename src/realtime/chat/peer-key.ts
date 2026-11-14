// packages
import { createHmac } from 'crypto';

// what a peer key looks like in a join ticket
export const PEER_KEY_PATTERN = /^[0-9a-f]{16}$/;

// the room a client's socket joins to hear peer-presence for one consultant
export const watchRoom = (key: string) => `watch:${key}`;

/**
 * the opaque key a user is known by in chat presence, so the app never sees a user id:
 * HMAC-SHA256(REALTIME_JWT_SECRET, "peer:" + userId), the first 16 hex characters. next.js
 * computes the same key for the join ticket's peer claim
 * @param userId the user's id
 * @returns the key, or null when the secret isn't set
 */
export function peerKey(userId: string): string | null {
  const secret = process.env.REALTIME_JWT_SECRET;
  if (!secret) return null;

  return createHmac('sha256', secret)
    .update(`peer:${userId}`)
    .digest('hex')
    .slice(0, 16);
}
