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

  if (!process.env.REALTIME_JWT_SECRET) return null;

  try {
    const secret = new TextEncoder().encode(process.env.REALTIME_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload as RealtimePayload;
  } catch {
    return null;
  }
}
