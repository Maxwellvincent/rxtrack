import { isHydrated as cloudIsHydrated, readCloud, subscribeToCloudStore, writeCloudAwait } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

export const key = "rxt-question-style-profile-v1";

export function read(userId) {
  return userId ? readCloud(userId, key, null) : readJson(userId, key, null);
}

export function writeAwait(userId, value) {
  if (!userId) {
    writeJson(userId, key, value);
    return Promise.resolve(value);
  }
  return writeCloudAwait(userId, key, value);
}

export function subscribe(userId, cb) {
  return subscribeToCloudStore(key, cb);
}

export function isHydrated(userId) {
  return !userId || cloudIsHydrated(userId, key);
}
