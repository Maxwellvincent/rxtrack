import { readCloud, writeCloudAwait, subscribeToCloudStore, isHydrated, readError } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

export const key = "rxt-manual-practice-v1";
const empty = {};

export const manualPracticeStore = {
  read: (uid) => uid ? readCloud(uid, key, empty) : readJson(uid, key, empty),
  write: (uid, value) => uid ? writeCloudAwait(uid, key, value) : Promise.resolve(writeJson(uid, key, value)),
  subscribe: (cb) => subscribeToCloudStore(key, cb),
  isHydrated: (uid) => !uid || isHydrated(uid, key),
  readError: (uid) => uid ? readError(uid, key) : null,
};

