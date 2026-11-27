// Today's queue is frozen once per study day. With an account the frozen queue
// lives in Firestore so every device shows the same topics; localStorage keeps a
// copy for signed-out use and for the moment before the cloud copy loads.

/** The shared queue for this block and day, or null. */
export function sharedQueueFor(doc, blockId, todayKey) {
  const entry = doc?.[blockId];
  return entry?.day === todayKey && Array.isArray(entry.items) ? { cap: Number(entry.cap) || entry.items.length, items: entry.items } : null;
}

/** The document with this block's queue replaced by today's. */
export function withSharedQueue(doc, blockId, todayKey, queue, now = Date.now()) {
  const items = Array.isArray(queue) ? queue : queue?.items || [];
  const cap = Array.isArray(queue) ? items.length : Number(queue?.cap) || items.length;
  return { ...(doc || {}), [blockId]: { day: todayKey, cap, items: items.map(({ id, kind }) => ({ id, kind })), updatedAt: now } };
}

/**
 * Which queue Today shows, and what to do about it.
 * - The cloud copy wins once it exists for today.
 * - Signed in, nothing is frozen or uploaded until the cloud copy has loaded,
 *   so a device never overwrites a queue another device already froze.
 */
export function resolveTodayQueue({ signedIn, cloudLoaded, shared, local }) {
  if (shared) return { queue: shared, canFreeze: false, upload: false };
  if (signedIn && !cloudLoaded) return { queue: local, canFreeze: false, upload: false };
  return { queue: local, canFreeze: !local, upload: signedIn && !!local };
}
