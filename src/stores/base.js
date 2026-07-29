const STORE_EVENT = "rxt-store-changed";
let storageBridgeInstalled = false;

export function physicalKey(userId, logicalKey) {
  return userId ? `rxt:${userId}:${logicalKey}` : logicalKey;
}

export function isKeyForStore(storageKey, logicalKey) {
  return storageKey === logicalKey || storageKey?.endsWith(`:${logicalKey}`);
}

function hasWindow() {
  return typeof window !== "undefined" && typeof window.addEventListener === "function";
}

function storage() {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { return fallback; }
}

function ensureStorageBridge() {
  if (!hasWindow() || storageBridgeInstalled) return;
  storageBridgeInstalled = true;
  window.addEventListener("storage", (event) => {
    const logicalKey = logicalKeyFromPhysical(event.key);
    if (logicalKey) notifyStoreChanged(logicalKey, { physicalKey: event.key, source: "storage" });
  });
}

export function logicalKeyFromPhysical(key) {
  if (!key) return null;
  const parts = key.split(":");
  return parts.length >= 3 && parts[0] === "rxt" ? parts.slice(2).join(":") : key;
}

export function readJson(userId, logicalKey, fallback) {
  const ls = storage();
  if (!ls) return fallback;
  const namespaced = userId ? ls.getItem(physicalKey(userId, logicalKey)) : null;
  if (namespaced != null) return parseJson(namespaced, fallback);
  return parseJson(ls.getItem(logicalKey), fallback);
}

/**
 * Where a write lands. A namespaced write beside an existing legacy key would
 * store a SECOND full copy of that key — with rxt-block-objectives at ~2MB that
 * blows the 5MB localStorage quota on the first write, and App.jsx (which reads
 * the unnamespaced keys) would stop seeing shell edits. So writes go to the slot
 * the data already occupies; only brand-new keys start out namespaced.
 *
 * Consequence, accepted deliberately: two accounts in the same browser share any
 * key that predates namespacing. App.jsx already behaves that way, and this
 * stops being true per key once App is retired and the data is migrated.
 */
export function resolveWriteKey(userId, logicalKey) {
  const ls = storage();
  if (!userId || !ls) return logicalKey;
  const namespaced = physicalKey(userId, logicalKey);
  if (ls.getItem(namespaced) != null) return namespaced;
  if (ls.getItem(logicalKey) != null) return logicalKey;
  return namespaced;
}

/**
 * `silent` is for the localStorage shadow a Firestore-backed store keeps for
 * App.jsx: that write is a copy of a change already being announced, and
 * announcing it twice makes every subscriber run twice per write.
 */
export function writeJson(userId, logicalKey, value, { fallback, merge, silent } = {}) {
  const ls = storage();
  if (!ls) return value;
  const next = merge ? merge(readJson(userId, logicalKey, fallback), value) : value;
  const target = resolveWriteKey(userId, logicalKey);
  ls.setItem(target, JSON.stringify(next));
  if (!silent) notifyStoreChanged(logicalKey, { physicalKey: target, userId });
  return next;
}

export function notifyStoreChanged(logicalKey, detail = {}) {
  if (!hasWindow()) return;
  ensureStorageBridge();
  window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: { ...detail, key: logicalKey } }));
}

export function subscribeToStore(logicalKey, cb) {
  if (!hasWindow()) return () => {};
  ensureStorageBridge();
  const handler = (event) => {
    if (event.detail?.key === logicalKey) cb();
  };
  window.addEventListener(STORE_EVENT, handler);
  return () => window.removeEventListener(STORE_EVENT, handler);
}

export const __test = { STORE_EVENT, logicalKeyFromPhysical };
