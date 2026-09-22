// rxt-mcq-bank conflict policy: additive KV merge keyed by `${objectiveId}_r${round}`.
//
// Every question generated is kept in the Firestore `mcq` collection. This local
// copy is a cache and is capped: unbounded, it was ~290KB of a ~5MB budget and
// grew with every drill.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeKvValue } from "./merge.js";
import { applyLocalCap, capMapEntries } from "./capped.js";

export const key = "rxt-mcq-bank";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
/**
 * localStorage is only a working cache; Firestore owns the complete bank.
 * A count cap alone is not enough because a few generated vignettes can each
 * contain a large explanation/figure payload. Keep shrinking the newest-entry
 * window until the browser cache accepts it rather than failing hydration.
 */
function writeCache(userId, value) {
  const capped = applyLocalCap(key, value);
  try {
    return writeJson(userId, key, capped);
  } catch (error) {
    const entries = Object.keys(capped || {}).length;
    for (let limit = Math.min(entries, 24); limit >= 1; limit = Math.floor(limit / 2)) {
      try {
        return writeJson(userId, key, capMapEntries(capped, limit));
      } catch { /* try a smaller working set */ }
    }
    try { writeJson(userId, key, {}); } catch { /* quota may be consumed by another cache */ }
    console.warn("mcq bank: local cache is full; Firestore remains authoritative", error?.message || error);
    return capped;
  }
}

export function write(userId, value) {
  return writeCache(userId, value);
}

// Merge incoming into stored under this key's conflict policy — the sync path.
export function merge(userId, incoming) {
  const merged = mergeKvValue(readJson(userId, key, fallback), incoming);
  return writeCache(userId, merged);
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
