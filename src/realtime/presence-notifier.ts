const NEXT_INTERNAL_URL = 'http://192.168.1.4:3000'; // process.env.NEXT_INTERNAL_URL;

/**
 * tells next.js a consultant's live presence changed so the db stays
 * consistent even when the change came from a dropped connection
 * rather than an explicit toggle
 */
export async function notifyPresenceChange(
  consultantId: string,
  online: boolean,
) {
  const url = `${NEXT_INTERNAL_URL}/api/internal/presence`;
  console.log(
    `[presence-notifier] calling ${url} for ${consultantId} online=${online}`,
  );

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SHARED_SECRET,
      },
      body: JSON.stringify({ consultantId, online }),
    });
    console.log(`[presence-notifier] response status: ${res.status}`);
  } catch (error) {
    console.error('[presence-notifier] failed to notify next.js:', error);
  }
}
