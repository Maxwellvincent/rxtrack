// Small preferences remain usable for this session if browser storage is full.
const sessionPreferences = new Map();
export function readPreference(key, fallback = null) {
  if (sessionPreferences.has(key)) return sessionPreferences.get(key);
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function writePreference(key, value) {
  sessionPreferences.set(key, value);
  try { localStorage.setItem(key, value); sessionPreferences.delete(key); return true; }
  catch { return false; }
}
export function storageReport(storage = globalThis.localStorage) {
  const entries = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith('rxt')) continue;
      const value = storage.getItem(key) || '';
      entries.push({ key: key.replace(/^rxt:[^:]+:/, ''), bytes: 2 * (key.length + value.length) });
    }
  } catch { /* unavailable browser storage */ }
  return { bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries: entries.sort((a, b) => b.bytes - a.bytes) };
}
// Never remove a divergent local copy: it may contain work not yet synced.
export function releaseConfirmedCloudCopy(key, value, storage = globalThis.localStorage) {
  try {
    const expected = JSON.stringify(value);
    if (storage.getItem(key) !== expected) return false;
    storage.removeItem(key);
    return true;
  } catch { return false; }
}
