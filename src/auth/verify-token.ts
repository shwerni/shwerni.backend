// packages
import { jwtVerify } from 'jose';

export type RealtimePayload = {
  userId: string;
  role: 'USER' | 'OWNER' | 'GUEST';
};

/**
 * verifies a short lived token minted by next.js, guests included
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
    return payload as RealtimePayload;
  } catch (error) {
    console.error(
      '[verify-token] verification failed:',
      (error as Error).message,
    );
    return null;
  }
}
