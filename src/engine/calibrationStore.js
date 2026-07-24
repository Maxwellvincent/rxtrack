// calibrationStore.js — local (throwaway) persistence for calibration records.
// Firestore schema is deferred (SP2); localStorage keeps the prototype self-contained.
// Record = { concept, confidence (1-5), correct (bool), ts }.
const KEY = "rxt-calibration";

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}

/** Calibration records for a block (array), oldest first. */
export function readCalibration(blockId) {
  const all = readAll();
  return Array.isArray(all[blockId]) ? all[blockId] : [];
}

/** Append one calibration record to a block and persist. */
export function appendCalibration(blockId, record) {
  if (!blockId || !record?.concept) return;
  const all = readAll();
  const list = Array.isArray(all[blockId]) ? [...all[blockId]] : [];
  list.push({ ts: Date.now(), ...record });
  all[blockId] = list;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
}
