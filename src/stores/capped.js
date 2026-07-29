/**
 * Local caps for stores whose history belongs in Firestore.
 *
 * Some stores are append-only and grow without limit: every generated MCQ,
 * every missed question, forever. Mirroring all of that into localStorage cost
 * ~630KB of a ~5MB budget that the lectures and objectives actually need, and
 * it only grows as more blocks are imported.
 *
 * The full history stays in the cloud — these keys are pushed to `kv` like any
 * other. What is kept locally is a working set: the recent entries, which are
 * the ones a session actually reads.
 */

/** Newest-last arrays (missed questions): keep the tail. */
export function capArray(list, max) {
  const arr = Array.isArray(list) ? list : [];
  return arr.length <= max ? arr : arr.slice(arr.length - max);
}

/**
 * Keyed maps (the MCQ bank, keyed `${objectiveId}_r${round}`): keep the most
 * recently touched entries.
 *
 * Ordering falls back to insertion order when an entry carries no timestamp,
 * which is what the existing bank entries look like — so this degrades to
 * "keep the last N added" rather than dropping everything.
 */
export function capMapEntries(map, max, stampOf = (v) => v?.savedAt || v?.updatedAt || v?.createdAt || null) {
  const obj = map && typeof map === "object" && !Array.isArray(map) ? map : {};
  const keys = Object.keys(obj);
  if (keys.length <= max) return obj;

  const ordered = keys
    .map((k, i) => ({ k, i, t: stampOf(obj[k]) }))
    .sort((a, b) => {
      if (a.t && b.t) return String(a.t).localeCompare(String(b.t));
      if (a.t) return 1;   // stamped entries are newer than unstamped ones
      if (b.t) return -1;
      return a.i - b.i;    // otherwise insertion order
    });

  const keep = ordered.slice(ordered.length - max);
  const out = {};
  for (const { k } of keep) out[k] = obj[k];
  return out;
}

/** How much of each capped store stays on this device. */
export const LOCAL_CAPS = {
  "rxt-mcq-bank": 40,
  "rxt-missed-questions": 50,
};

/** Apply the cap for a key, if it has one. Anything else passes through. */
export function applyLocalCap(key, value) {
  const max = LOCAL_CAPS[key];
  if (!max) return value;
  return Array.isArray(value) ? capArray(value, max) : capMapEntries(value, max);
}
