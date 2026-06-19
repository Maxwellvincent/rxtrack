import { pickWeightedItems, fetchRecognitionItems, buildBlockBank } from "../recognitionBank.js";

/** Best bank item for a concept (content match), else first, else null. */
export function pickItemForConcept(items, conceptName) {
  if (!items?.length) return null;
  const [match] = pickWeightedItems(items, [conceptName], 1);
  return match || items[0];
}

/** Ensure a block has bank items; build a small batch if empty. */
export async function ensureBlockItems(userId, blockId) {
  let items = await fetchRecognitionItems(userId, blockId);
  if (!items.length && userId) {
    await buildBlockBank(userId, blockId, { cap: 12 });
    items = await fetchRecognitionItems(userId, blockId);
  }
  return items;
}
