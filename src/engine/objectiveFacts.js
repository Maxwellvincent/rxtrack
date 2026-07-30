/**
 * Learning objectives → source facts for the recognition bank.
 *
 * `buildRecognitionBank` turns one fact into patient vignettes, reading its
 * facts from `users/{uid}/ungeneratedCards`. That collection was only ever meant
 * to be filled by the Anki ingest, and the ingest never wrote it — so the pool
 * was permanently empty and the engine had nothing to study for any block.
 *
 * Objectives are the better source anyway: they are the school's own statement
 * of what you are expected to know, there are ~1,900 of them across the blocks,
 * and each already carries the lecture it came from.
 *
 * Pure — the caller reads the objectives and writes the rows.
 */

/** Longer than this and it is a paragraph, not a fact worth a vignette. */
const MAX_FACT = 600;
/** Shorter than this and there is nothing to build a case on ("Thyroid."). */
const MIN_FACT = 25;

const textOf = (o) => String(o?.objective || o?.text || "").trim();

/**
 * One row per objective, in the shape the Cloud Function reads.
 *
 * `card_id` is derived from the objective id so a re-seed overwrites the same
 * document instead of duplicating it, and so a fact already generated stays
 * generated — the function deletes the row once it has produced its vignettes.
 */
export function objectivesToCards(objectives, { blockId, lecturesById = new Map() } = {}) {
  const seen = new Set();
  const rows = [];

  for (const objective of objectives || []) {
    const text = textOf(objective);
    if (text.length < MIN_FACT || text.length > MAX_FACT) continue;

    // This data has duplicate objective rows sharing a code and text; the same
    // fact twice is two Gemini calls for one vignette set.
    const dedupeKey = (objective.code || text).toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const lecture = lecturesById.get(objective.linkedLecId) || null;
    rows.push({
      card_id: `obj-${objective.id}`,
      block_id: blockId,
      // The function orders weak subjects first and tags generated items with
      // the subject, so the lecture title is the useful grouping here.
      subject: lecture?.lectureTitle || lecture?.fileName || objective.activity || "objective",
      lecture: lecture?.lectureTitle || null,
      text,
      source: "objective",
      objective_id: objective.id,
      objective_code: objective.code || null,
    });
  }

  return rows;
}

/**
 * Which facts still need seeding.
 *
 * A card the function has already turned into vignettes is deleted from the
 * pool, so re-adding it would regenerate — and pay for — items that already
 * exist. Anything already in `recognitionItems` is therefore excluded by its
 * source card id.
 */
export function cardsToSeed(rows, { existingCardIds = [], generatedCardIds = [] } = {}) {
  const skip = new Set([...existingCardIds, ...generatedCardIds]);
  return (rows || []).filter((r) => !skip.has(r.card_id));
}
