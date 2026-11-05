export type RealtimePayload = {
  userId: string;
  role: 'USER' | 'OWNER' | 'GUEST';
};

const ROLES: readonly string[] = ['USER', 'OWNER', 'GUEST'];

/**
 * the connection token's claims, or null when they aren't a connection token's. next.js mints
 * these with no audience; any token that names one (a chat join ticket, an attachment token)
 * is for something else and never opens a connection. kept apart from verify-token.ts so it can
 * be tested without jose
 * @param claims the verified token's payload
 */
export function toRealtimePayload(
  claims: Record<string, unknown>,
): RealtimePayload | null {
  if (claims.aud !== undefined) return null;

  const { userId, role } = claims;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  if (typeof role !== 'string' || !ROLES.includes(role)) return null;

  return { userId, role: role as RealtimePayload['role'] };
}
