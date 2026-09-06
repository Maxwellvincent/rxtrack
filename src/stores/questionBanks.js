/** Question banks persisted one bank per Firestore kv document. */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloudAwait,
} from "./cloudBase.js";
import { readJson } from "./base.js";

export const key = "rxt-question-banks";
const indexKey = "rxt-question-bank-index-v2";
const fallback = {};
let activeUserId = null;
const shardKey = (filename) => `rxt-question-bank-v2:${filename}`;

function legacy(userId) {
  return userId ? readCloud(userId, key, fallback) : readJson(userId, key, fallback);
}
function index(userId) {
  return userId ? readCloud(userId, indexKey, fallback) : {};
}

export function read(userId) {
  if (!userId) return legacy(userId);
  activeUserId = userId;
  const result = { ...(legacy(userId) || {}) };
  for (const [filename, entry] of Object.entries(index(userId) || {})) {
    if (entry?.deleted) {
      delete result[filename];
      continue;
    }
    const questions = readCloud(userId, shardKey(filename), null);
    if (Array.isArray(questions)) result[filename] = questions;
  }
  return result;
}

async function persist(userId, value) {
  if (!userId) return value;
  activeUserId = userId;
  const desired = value || {};
  const current = read(userId);
  const nextIndex = { ...(index(userId) || {}) };
  const writes = [];
  for (const [filename, questions] of Object.entries(desired)) {
    // Callers assemble a new outer object but preserve unchanged bank arrays.
    // Do not migrate every legacy bank merely because it lacks a v2 entry.
    if (current[filename] === questions) continue;
    writes.push(writeCloudAwait(userId, shardKey(filename), questions));
    nextIndex[filename] = { updatedAt: Date.now() };
  }
  for (const filename of Object.keys(current)) {
    if (!Object.prototype.hasOwnProperty.call(desired, filename)) {
      nextIndex[filename] = { deleted: true, updatedAt: Date.now() };
    }
  }
  await Promise.all(writes);
  await writeCloudAwait(userId, indexKey, nextIndex);
  return value;
}

export function write(userId, value) {
  if (!userId) return value;
  persist(userId, value).catch((error) => console.warn("question banks: write failed", error?.message || error));
  return value;
}
export function writeAwait(userId, value) { return persist(userId, value); }
export function saveBank(userId, filename, questions) {
  if (!filename) return read(userId);
  const next = { ...(read(userId) || {}), [filename]: questions };
  write(userId, next);
  return next;
}
export function removeBank(userId, filename) {
  const next = { ...(read(userId) || {}) };
  delete next[filename];
  write(userId, next);
  return next;
}
export function merge(userId, incoming) {
  const next = { ...(read(userId) || {}), ...(incoming || {}) };
  write(userId, next);
  return next;
}

export function subscribe(cb) {
  let shardUnsubs = [];
  const subscribeShards = () => {
    shardUnsubs.forEach((unsub) => unsub());
    shardUnsubs = activeUserId
      ? Object.keys(index(activeUserId) || {}).map((filename) => subscribeToCloudStore(shardKey(filename), cb))
      : [];
    cb();
  };
  const unsubs = [subscribeToCloudStore(key, cb), subscribeToCloudStore(indexKey, subscribeShards)];
  return () => { unsubs.forEach((unsub) => unsub()); shardUnsubs.forEach((unsub) => unsub()); };
}
export function isHydrated(userId) {
  if (!userId) return true;
  activeUserId = userId;
  if (!cloudIsHydrated(userId, key) || !cloudIsHydrated(userId, indexKey)) return false;
  return Object.entries(index(userId) || {}).every(([filename, entry]) => entry?.deleted || cloudIsHydrated(userId, shardKey(filename)));
}
export function readError(userId) {
  if (!userId) return null;
  return cloudReadError(userId, key) || cloudReadError(userId, indexKey) ||
    Object.keys(index(userId) || {}).map((filename) => cloudReadError(userId, shardKey(filename))).find(Boolean) || null;
}
