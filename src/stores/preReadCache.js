// rxt-preread-cache — generated pre-reads, local only.
//
// Deliberately NOT cloud-backed: this is a regenerable model output, not user
// data. Losing it on another device costs one background generation, while
// syncing it would put several KB of questions per lecture into Firestore for
// no gain.
import { readJson, writeJson, subscribeToStore, notifyStoreChanged, resolveWriteKey } from "./base.js";

export const key = "rxt-preread-cache";
const fallback = {};
const sessionCache = new Map();
// Regenerable output only: retain at most 20 recent lectures and 250 KB.
export function boundCache(value) {
  const entries = Object.entries(value || {}).sort((a, b) => String(b[1]?.generatedAt || "").localeCompare(String(a[1]?.generatedAt || "")));
  const next = {};
  for (const [id, entry] of entries.slice(0, 20)) {
    const candidate = { ...next, [id]: entry };
    if (JSON.stringify(candidate).length <= 125000) next[id] = entry;
  }
  return next;
}

export function read(userId) {
  return sessionCache.get(userId) ?? boundCache(readJson(userId, key, fallback));
}

export function write(userId, value) {
  const next = boundCache(value);
  sessionCache.set(userId, next);
  try { writeJson(userId, key, next); sessionCache.delete(userId); }
  catch {
    // Only this disposable cache is removed; study records are never touched.
    try { localStorage.removeItem(resolveWriteKey(userId, key)); } catch { /* storage unavailable */ }
    notifyStoreChanged(key, { userId, source: "memory" });
  }
  return next;
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
