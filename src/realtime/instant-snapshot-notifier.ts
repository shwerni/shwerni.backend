const NEXT_INTERNAL_URL = process.env.NEXT_INTERNAL_URL;

/**
 * records a lightweight daily stats snapshot in next.js, fire-and-forget
 * so it never blocks or slows down the actual connection handling
 */
export async function notifyInstantSnapshot(
  consultantsNow: number,
  clientsNow: number,
  role: 'OWNER' | 'USER' | 'GUEST',
) {
  try {
    await fetch(`${NEXT_INTERNAL_URL}/api/internal/instant-snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SHARED_SECRET,
      },
      body: JSON.stringify({ consultantsNow, clientsNow, role }),
    });
  } catch (error) {
    console.error('failed to notify instant snapshot', error);
  }
}
