// packages
import { errors, jwtVerify } from 'jose';

export type ChatTicketResult =
  { claims: Record<string, unknown> } | { error: 'expired' | 'invalid' };

/**
 * verifies a chat join ticket minted by next.js: HS256 with REALTIME_JWT_SECRET, audience
 * "chat-join", issuer "shwerni-next", at most 60s old. who it is for is checked afterwards
 * (toChatJoin)
 * @param ticket the ticket from chat-join
 */
export async function verifyChatTicket(
  ticket: unknown,
): Promise<ChatTicketResult> {
  if (typeof ticket !== 'string' || ticket.length === 0)
    return { error: 'invalid' };

  const secret = process.env.REALTIME_JWT_SECRET;
  if (!secret) {
    console.error('[chat-ticket] REALTIME_JWT_SECRET is not set');
    return { error: 'invalid' };
  }

  try {
    const { payload } = await jwtVerify(
      ticket,
      new TextEncoder().encode(secret),
      {
        algorithms: ['HS256'],
        audience: 'chat-join',
        issuer: 'shwerni-next',
        maxTokenAge: '60s',
        clockTolerance: '5s',
      },
    );
    return { claims: payload };
  } catch (error) {
    return error instanceof errors.JWTExpired
      ? { error: 'expired' }
      : { error: 'invalid' };
  }
}
