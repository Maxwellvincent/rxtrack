// src/idCodec.js — pure, dependency-free (importable from browser AND node)
export function encodeDocId(s) {
  return encodeURIComponent(String(s)).replace(/\./g, "%2E").replace(/^__/, "%5F%5F");
}
export function decodeDocId(s) { return decodeURIComponent(s); }
