// Missed questions the learner marked as learned. The miss stays in the answer
// journal (accuracy is unchanged); it only leaves the redo queue.
import { readJson, writeJson } from './base.js';
import { readCloud, isHydrated as hydrated, readError as error, subscribeToCloudStore, updateCloudAwait } from './cloudBase.js';

export const key = 'rxt-dismissed-misses-v1';
const empty = () => ({ ids: {} });
export const read = userId => userId ? readCloud(userId, key, empty()) : readJson(userId, key, empty());
export const isHydrated = userId => !userId || hydrated(userId, key);
export const readError = userId => userId ? error(userId, key) : null;
export const subscribe = callback => subscribeToCloudStore(key, callback);

/** Mark question identities as learned (removed from the missed queue). */
export async function dismiss(userId, identities = [], at = Date.now()) {
  const apply = current => ({ ids: { ...(current?.ids || {}), ...Object.fromEntries(identities.map(id => [id, at])) } });
  if (userId) return updateCloudAwait(userId, key, current => apply(current || empty()));
  const next = apply(read(null)); writeJson(null, key, next); return next;
}
