// packages
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.REALTIME_JWT_SECRET);

export type RealtimePayload = {
  userId: string;
  role: 'USER' | 'OWNER';
  platform: 'web' | 'mobile';
};

/**
 * verifies a short lived token minted by next.js after checking
 * either next-auth or better-auth session, whichever platform sent it
 */
export async function verifyRealtimeToken(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as RealtimePayload;
  } catch {
    return null;
  }
}
