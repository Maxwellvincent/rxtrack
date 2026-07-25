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

export function writeJson(userId, logicalKey, value, { fallback, merge } = {}) {
  const ls = storage();
  if (!ls) return value;
  const next = merge ? merge(readJson(userId, logicalKey, fallback), value) : value;
  ls.setItem(physicalKey(userId, logicalKey), JSON.stringify(next));
  notifyStoreChanged(logicalKey, { physicalKey: physicalKey(userId, logicalKey), userId });
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
