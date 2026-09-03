/**
 * rxt-question-bank-meta — Firestore-first, one kv document.
 *
 * Sibling to `questionBanks.js`. That store keeps `{filename: Question[]}`
 * flat and shared across blocks (see its own header for why); this store
 * layers per-upload metadata on top — which block an upload was made for and
 * when — without touching the existing shape any consumer already depends on.
 *
 * Single-owner-per-filename: `questionBanksStore` content is genuinely shared
 * by filename, so only one meta entry can currently claim a given filename.
 * Re-uploading the same filename under a different block replaces the old
 * claim rather than creating a second one — a known, accepted limitation of
 * the underlying shared store.
 */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson } from "./base.js";

export const key = "rxt-question-bank-meta";
const fallback = {};

function generateBankId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bank-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function read(userId) {
  if (!userId) return readJson(userId, key, fallback);
  return readCloud(userId, key, fallback);
}

// Authoritative replace — same contract as questionBanks.write.
export function write(userId, value) {
  if (!userId) return value;
  return writeCloud(userId, key, value);
}

/**
 * Record a new upload, replacing any existing entry (any bankId) that
 * currently claims this filename — single-owner-per-filename.
 */
export function recordUpload(userId, { filename, blockId, sourceKind = "school" }) {
  if (!filename) return read(userId);
  const current = read(userId) || {};
  const next = {};
  for (const [id, entry] of Object.entries(current)) {
    if (entry?.filename === filename) continue;
    next[id] = entry;
  }
  const bankId = generateBankId();
  next[bankId] = { filename, blockId, sourceKind, uploadedAt: Date.now() };
  return write(userId, next);
}

/**
 * Newest meta entry for a block, skipping any entry whose filename is not in
 * `existingFilenames` (a stale entry — the underlying bank content was
 * removed or reclaimed by another filename's upload). Pure function of its
 * arguments plus its own store read.
 */
export function newestForBlock(userId, blockId, { existingFilenames } = {}) {
  const known = new Set(existingFilenames || []);
  const entries = Object.values(read(userId) || {});
  let newest = null;
  for (const entry of entries) {
    if (!entry || entry.blockId !== blockId) continue;
    if (!known.has(entry.filename)) continue;
    if (!newest || (entry.uploadedAt || 0) > (newest.uploadedAt || 0)) newest = entry;
  }
  return newest;
}

export function subscribe(cb) {
  return subscribeToCloudStore(key, cb);
}

export function isHydrated(userId) {
  return cloudIsHydrated(userId, key);
}

export function readError(userId) {
  return cloudReadError(userId, key);
}
