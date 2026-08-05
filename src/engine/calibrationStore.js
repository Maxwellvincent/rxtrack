// calibrationStore.js — the study path's calibration records.
// Record = { concept, confidence (1-5), correct (bool), ts }.
//
// Storage is Firestore-first now (src/stores/calibrationByBlock.js), so the accuracy curve and
// the landmine list are the same on the laptop and the phone. Signed out it falls back to
// localStorage, which is what keeps the anon prototype path and the tests working.
import * as store from "../stores/calibrationByBlock.js";

/** Calibration records for a block (array), oldest first. */
export function readCalibration(userId, blockId) {
  return store.readBlock(userId, blockId);
}

/** Append one calibration record to a block and persist. */
export function appendCalibration(userId, blockId, record) {
  if (!blockId || !record?.concept) return;
  store.appendRecord(userId, blockId, record);
}
