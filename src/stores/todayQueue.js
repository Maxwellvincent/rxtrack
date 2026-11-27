// rxt-today-queue-v1 — today's frozen Today-plan queue per block, shared across
// devices. Shape: { [blockId]: { day: "YYYY-MM-DD", cap, items: [{ id, kind }], updatedAt } }.
// Each block keeps only its latest day, so the document stays small.
import { readCloud, writeCloudAwait, subscribeToCloudStore, isHydrated as cloudIsHydrated, readError as cloudReadError } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

export const key = "rxt-today-queue-v1";
export const read = userId => userId ? readCloud(userId, key, {}) : readJson(userId, key, {});
export const write = (userId, value) => userId ? writeCloudAwait(userId, key, value) : Promise.resolve(writeJson(userId, key, value));
export const subscribe = cb => subscribeToCloudStore(key, cb);
export const isHydrated = userId => !userId || cloudIsHydrated(userId, key);
export const readError = userId => userId ? cloudReadError(userId, key) : null;
