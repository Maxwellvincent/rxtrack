import { readCloud, isHydrated as hydrated, subscribeToCloudStore, updateCloudAwait } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { emptyPartsInventory } from "../engine/objectiveParts.js";

/** One parts inventory per lecture (see engine/objectiveParts.js). */
export const keyFor = (lectureId) => `rxt-objective-parts-v1:${lectureId}`;
export const read = (userId, lectureId) => (userId ? readCloud(userId, keyFor(lectureId), emptyPartsInventory()) : readJson(null, keyFor(lectureId), emptyPartsInventory()));
export const isHydrated = (userId, lectureId) => !userId || hydrated(userId, keyFor(lectureId));
export const subscribe = (lectureId, callback) => subscribeToCloudStore(keyFor(lectureId), callback);

/**
 * Merge a freshly built inventory into the stored one. Parts already stored for an
 * objective are kept while the lecture text is unchanged, so answers tagged with
 * their ids keep counting; a new source version replaces everything.
 */
export function mergeInventory(current, incoming) {
  if (!current || current.sourceVersion !== incoming.sourceVersion || current.version !== incoming.version) return incoming;
  return {
    ...incoming,
    objectives: { ...incoming.objectives, ...current.objectives },
    questionParts: { ...incoming.questionParts, ...current.questionParts },
    attempted: [...new Set([...(current.attempted || []), ...(incoming.attempted || [])])],
  };
}

export async function save(userId, lectureId, inventory) {
  if (userId) return updateCloudAwait(userId, keyFor(lectureId), (current) => mergeInventory(current, inventory));
  const next = mergeInventory(read(null, lectureId), inventory);
  writeJson(null, keyFor(lectureId), next);
  return next;
}
