/**
 * Attach a learning objective to weak concepts that were saved with a lecture
 * but no objective. Most such concepts are named after an objective's own
 * wording, so an exact or unique-prefix text match settles them; the rest need
 * clear word overlap that beats the runner-up. Additive only: a concept that
 * already has objectiveIds is never touched, and an unclear match links nothing.
 */
const STOP = new Set("the and for with from that this these those into onto their its are was were has have had can will may such each which what when where how why who whom than then them they also both between among about over under upon via per describe explain list identify discuss compare contrast define outline understand student students including include includes following given based use used using role roles".split(" "));
const BROAD_TAGS = new Set(["exam-report", "integrated-exam"]);
const MIN_SCORE = 0.55;
const MIN_MARGIN = 0.08;

const norm = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = value => new Set(norm(value).split(" ").filter(word => word.length > 2 && !STOP.has(word)));
const objectiveText = objective => objective?.objective || objective?.text || "";
const objectiveId = objective => objective?.id || objective?.code || objective?.objectiveCode || null;

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** Best objective for one concept, or null when nothing is clearly right. */
export function matchWeakConceptObjective(concept, objectives = []) {
  const pool = objectives.filter(objective => objectiveId(objective) && objectiveText(objective));
  if (!pool.length) return null;
  const description = norm(concept?.description), name = norm(concept?.concept);
  const exact = pool.filter(objective => { const text = norm(objectiveText(objective)); return text && (text === description || text === name); });
  if (exact.length === 1) return { objectiveId: objectiveId(exact[0]), method: "exact", score: 1 };
  const prefix = name.length >= 15 ? pool.filter(objective => norm(objectiveText(objective)).startsWith(name)) : [];
  if (prefix.length === 1) return { objectiveId: objectiveId(prefix[0]), method: "prefix", score: 1 };
  const missWords = words(`${concept?.concept || ""} ${concept?.description || ""}`);
  const scored = (exact.length > 1 ? exact : prefix.length > 1 ? prefix : pool)
    .map(objective => ({ objective, score: dice(missWords, words(objectiveText(objective))) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < MIN_SCORE || (second && best.score - second.score < MIN_MARGIN)) return null;
  return { objectiveId: objectiveId(best.objective), method: "overlap", score: Math.round(best.score * 100) / 100 };
}

/**
 * Link every unlinked concept in the store ({blockId: concept[]}, other keys
 * kept as-is). `objectivesForBlock(blockId)` returns that block's objectives;
 * candidates are the objectives of the concept's linked lectures, else its block.
 * Returns the same store object when nothing changes.
 */
export function linkWeakConceptObjectives(store, objectivesForBlock, { blockIds = null, now = Date.now() } = {}) {
  if (!store || typeof store !== "object") return store;
  const allBlocks = blockIds || Object.keys(store).filter(key => Array.isArray(store[key]));
  const byLecture = new Map();
  for (const blockId of allBlocks) for (const objective of objectivesForBlock(blockId) || []) {
    const lectureId = objective?.linkedLecId || objective?.lectureId;
    if (!lectureId) continue;
    if (!byLecture.has(lectureId)) byLecture.set(lectureId, []);
    byLecture.get(lectureId).push(objective);
  }
  let changed = false;
  const next = { ...store };
  for (const [blockId, concepts] of Object.entries(store)) {
    if (!Array.isArray(concepts)) continue;
    let blockChanged = false;
    const linked = concepts.map(concept => {
      if (!concept || (concept.objectiveIds || []).length || (concept.tags || []).some(tag => BROAD_TAGS.has(tag)) || concept.objectiveLink) return concept;
      const lectureObjectives = (concept.linkedLecIds || []).flatMap(id => byLecture.get(id) || []);
      const candidates = lectureObjectives.length ? lectureObjectives : (objectivesForBlock(concept.blockId || blockId) || []);
      // No objectives loaded for it yet: leave it for a later pass.
      if (!candidates.length) return concept;
      const match = matchWeakConceptObjective(concept, candidates);
      blockChanged = true;
      // Remember a failed attempt too, so the same concept is not re-scored on every load.
      return match
        ? { ...concept, objectiveIds: [match.objectiveId], objectiveLink: { method: match.method, score: match.score, at: now } }
        : { ...concept, objectiveLink: { method: "none", at: now } };
    });
    if (blockChanged) { next[blockId] = linked; changed = true; }
  }
  return changed ? next : store;
}
