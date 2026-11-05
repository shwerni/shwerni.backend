// packages
import { jwtVerify } from 'jose';

// utils
import { toRealtimePayload } from './realtime-claims.js';

export type { RealtimePayload } from './realtime-claims.js';

/**
 * verifies a short lived token minted by next.js, guests included. a valid signature isn't
 * enough: the claims must be a connection token's (no audience, a known role, a user id)
 */
export async function verifyRealtimeToken(token: string | undefined) {
  if (!token) return null;

  if (!process.env.REALTIME_JWT_SECRET) {
    console.error('[verify-token] REALTIME_JWT_SECRET is not set');
    return null;
  }

  try {
    const secret = new TextEncoder().encode(process.env.REALTIME_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    const realtime = toRealtimePayload(payload);
    if (!realtime) console.error('[verify-token] not a connection token');
    return realtime;
  } catch (error) {
    console.error(
      '[verify-token] verification failed:',
      (error as Error).message,
    );
    return null;
  }
}
