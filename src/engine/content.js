import { pickWeightedItems, fetchRecognitionItems, buildBlockBank } from "../recognitionBank.js";
import { getUngeneratedCards, saveUngeneratedCards } from "../supabase.js";
import * as objectivesStore from "../stores/blockObjectives.js";
import * as lecturesStore from "../stores/lectures.js";
import { selectBlockObjectives } from "../shell/logic/objectives.js";
import { cardsToSeed, objectivesToCards } from "./objectiveFacts.js";

/** Best bank item for a concept (content match), else first, else null. */
export function pickItemForConcept(items, conceptName) {
  if (!items?.length) return null;
  const [match] = pickWeightedItems(items, [conceptName], 1);
  return match || items[0];
}

/**
 * How many facts a first run turns into vignettes.
 *
 * A block has hundreds of objectives and each fact costs a Gemini call, so
 * seeding the pool is cheap but generating from all of it is not — and a session
 * only needs a burst of ten. The pool keeps the rest; the next visit generates
 * the next slice.
 */
const FIRST_RUN_CAP = 12;

/**
 * Fill the fact pool from this block's objectives.
 *
 * `ungeneratedCards` is what buildRecognitionBank reads its facts from, and
 * nothing ever wrote it — `saveUngeneratedCards` had no caller in any commit, so
 * every block reported "nothing to study" however many lectures and objectives
 * it had. Objectives are the right source: they are the school's own statement
 * of what you must know, and each carries the lecture it came from.
 */
async function seedFactsFromObjectives(userId, blockId, generatedCardIds) {
  const objectives = selectBlockObjectives(objectivesStore.read(userId), blockId);
  if (!objectives.length) return 0;

  const lecturesById = new Map(
    (lecturesStore.read(userId) || []).filter((l) => l?.id).map((l) => [l.id, l])
  );
  const rows = objectivesToCards(objectives, { blockId, lecturesById });

  const queued = (await getUngeneratedCards(userId))
    .filter((c) => c?.block_id === blockId)
    .map((c) => c.card_id ?? c.id);

  const toSeed = cardsToSeed(rows, { existingCardIds: queued, generatedCardIds });
  if (!toSeed.length) return queued.length;

  const { error } = await saveUngeneratedCards(userId, toSeed);
  if (error) throw error;
  return queued.length + toSeed.length;
}

/**
 * Ensure a block has bank items, building them from its objectives if it has
 * none.
 *
 * Reports progress: seeding is quick, generation is a Gemini call per fact and
 * takes long enough that silence reads as a hang.
 */
export async function ensureBlockItems(userId, blockId, { onProgress } = {}) {
  const items = await fetchRecognitionItems(userId, blockId);
  if (items.length || !userId) return items;

  onProgress?.({ phase: "seeding" });
  const generatedCardIds = items.map((i) => i.source_card_id).filter(Boolean);
  const pooled = await seedFactsFromObjectives(userId, blockId, generatedCardIds);
  if (!pooled) return items; // no objectives in this block — nothing to build from

  onProgress?.({ phase: "generating", pooled });
  const { generated, error } = await buildBlockBank(userId, blockId, {
    cap: FIRST_RUN_CAP,
    onProgress: (p) => onProgress?.({ phase: "generating", pooled, ...p }),
  });

  const built = await fetchRecognitionItems(userId, blockId);

  // A build that produced nothing is not the same as a block with no material,
  // and saying the wrong one sends you off to re-import lectures you already
  // have. This happened live: the generator is hard-wired to Gemini with no
  // fallback, the key's credits were spent, and every fact 429'd.
  if (!built.length) {
    onProgress?.({
      phase: "failed",
      pooled,
      generated,
      error: error || new Error("The question generator returned nothing for any of the facts."),
    });
  }
  return built;
}
