import { isHydrated as cloudIsHydrated, readCloud, readError as cloudReadError, subscribeToCloudStore, writeCloudAwait } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

const prefix = "rxt-question-bank-analysis-v1:";
const keyFor = (filename) => `${prefix}${filename}`;

export function read(userId, filename) {
  if (!filename) return null;
  return userId ? readCloud(userId, keyFor(filename), null) : readJson(userId, keyFor(filename), null);
}

export function writeAwait(userId, filename, value) {
  if (!filename) return Promise.resolve(value);
  if (!userId) { writeJson(userId, keyFor(filename), value); return Promise.resolve(value); }
  return writeCloudAwait(userId, keyFor(filename), value);
}

export function subscribe(filename, cb) {
  return subscribeToCloudStore(keyFor(filename), cb);
}

export function isHydrated(userId, filename) {
  return !userId || !filename || cloudIsHydrated(userId, keyFor(filename));
}

export function readError(userId, filename) {
  return userId && filename ? cloudReadError(userId, keyFor(filename)) : null;
}
