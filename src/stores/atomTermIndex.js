/**
 * Cross-lecture atom term index — one Firestore kv doc per block.
 *
 * Logical key: `rxt-atom-index-${blockId}`
 * Shape: { [normTerm]: { term, type, count, lectureIds: string[] } }
 *
 * Cheap to write (only written after atom extraction), cheap to read
 * (one doc per block, ~40 atoms × N lectures × ~80 bytes = <50KB).
 */
import { readCloud, writeCloud, subscribeToCloudStore } from "./cloudBase.js";
import { mergeAtomsIntoIndex } from "../engine/atomNorm.js";

const KEY_PREFIX = "rxt-atom-index-";
const fallback = {};

function key(blockId) {
  return KEY_PREFIX + blockId;
}

export function read(userId, blockId) {
  return readCloud(userId, key(blockId), fallback);
}

export function write(userId, blockId, value) {
  if (!userId || !blockId) return value;
  return writeCloud(userId, key(blockId), value);
}

export function subscribe(blockId, cb) {
  return subscribeToCloudStore(key(blockId), cb);
}

/**
 * Merge a lecture's atoms into the index, then write back.
 * Safe to call after every extraction — skips re-adding the same lectureId.
 */
export function upsertLectureAtoms(userId, blockId, lectureId, atoms) {
  if (!userId || !blockId || !lectureId) return;
  const current = read(userId, blockId) || {};
  const next = mergeAtomsIntoIndex(current, lectureId, atoms);
  return write(userId, blockId, next);
}
