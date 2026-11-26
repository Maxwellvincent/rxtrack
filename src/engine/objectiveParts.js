// Objective parts: the lecture elements one objective asks the learner to handle.
//
// "Clinically differentiate the psychotic disorders from other conditions" names
// one task, but the lecture behind it teaches several separate things to tell
// apart (duration thresholds, schizoaffective vs mood disorder, delusional
// disorder, catatonia...). Those elements live in the lecture, not in the
// objective's wording, so they are extracted once per lecture, each anchored to
// a quotation that must occur on the cited source page.
//
// Coverage is read from the learner's independent answers. An objective is not
// "Mastered" until every part has at least one independent correct answer.
import { stableRecordId } from "./sourceUse.js";
import { isIndependentAttempt } from "./practiceAssistance.js";

export const PARTS_VERSION = 1;
export const MAX_PARTS = 8;
const norm = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const objectiveKey = (objective) => String(objective?.id || objective?.code || "");
// Same hash as stores/learnerEvidence.questionEvidenceKey (journal events carry
// this form); kept local so the engine does not import a store.
const evidenceKey = (value) => {
  const input = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!input) return "";
  if (/^e_[a-z0-9]+$/.test(input)) return input;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `e_${(hash >>> 0).toString(36)}`;
};

/**
 * Stable identity for the lecture text the inventory was built from. Words only,
 * so the lecture flow (chunk pages) and exam generation (joined text) agree.
 */
export function partsSourceVersion(pages = []) {
  return stableRecordId([words(pages.map((page) => page.text).join(" ")).join(" ")], "parts-src2");
}

/** The first-release identity (page split + whitespace), still accepted. */
export function legacyPartsSourceVersion(pages = []) {
  return stableRecordId(pages.map((page) => [Number(page.page), norm(page.text)]), "parts-src");
}

/** True when an inventory was built from this lecture text. */
export function sourceMatches(inventory, pages = []) {
  const version = inventory?.sourceVersion;
  return Boolean(version) && (version === partsSourceVersion(pages) || version === legacyPartsSourceVersion(pages));
}

/**
 * One inventory across several lectures (block and CBSE dashboards, exams).
 * Objective ids and part ids are unique per lecture, so maps merge directly.
 */
export function combineInventories(inventories = []) {
  const out = { ...emptyPartsInventory(), lectureId: null, objectives: {}, questionParts: {} };
  for (const inventory of inventories) {
    if (!inventory || inventory.version !== PARTS_VERSION) continue;
    Object.assign(out.objectives, inventory.objectives || {});
    Object.assign(out.questionParts, inventory.questionParts || {});
  }
  return out;
}

export function emptyPartsInventory() {
  return { version: PARTS_VERSION, lectureId: null, sourceVersion: null, objectives: {}, questionParts: {}, builtAt: null };
}

/** Pages trimmed to a character budget, keeping every page represented. */
function pagesForPrompt(pages = [], budget = 60000) {
  const per = Math.max(400, Math.floor(budget / Math.max(1, pages.length)));
  return pages.map((page) => `[page ${page.page}]\n${String(page.text || "").slice(0, per)}`).join("\n\n");
}

/**
 * One prompt that (a) splits every objective into the lecture elements it covers
 * and (b) assigns already-answered questions to those parts, so past practice keeps
 * its credit.
 */
export function buildObjectivePartsPrompt({ objectives = [], pages = [], answered = [] } = {}) {
  const rows = objectives.map((objective) => ({ objectiveId: objectiveKey(objective), objective: String(objective.objective || objective.text || "").trim() }))
    .filter((row) => row.objectiveId && row.objective);
  const history = answered.slice(0, 60).map((question) => ({
    questionKey: question.questionKey,
    objectiveId: question.objectiveId,
    stem: String(question.stem || "").slice(0, 260),
    keyed: String(question.keyed || "").slice(0, 80),
    facet: question.facet || null,
  }));
  return `You are mapping medical-school learning objectives to the lecture content they cover.

For EACH objective, list its PARTS: the distinct lecture elements a student must be able to handle to meet the objective. Use the lecture, not general knowledge, to decide what the objective covers.
- An objective that names a group ("the psychotic disorders", "the feeding and eating disorders, including any subtypes", "the cranial nerves") covers each member or contrast THIS lecture teaches. One part per member or per explicitly taught contrast.
- An objective with several clauses ("describe X, its mechanism and side effects") gets one part per clause the lecture supports.
- A single narrow objective gets exactly one part.
- At most ${MAX_PARTS} parts per objective; merge the least important when there are more. Never invent a part the lecture does not teach.
- label: 2-10 words naming what is tested (e.g. "Brief psychotic vs schizophreniform: duration").
- quote: a short verbatim sentence or phrase (16-200 characters) copied EXACTLY from the cited page that teaches this part.
- page: the page number the quote is copied from.

Then assign each ALREADY-ANSWERED question below to the one part of its objective that it tested (partIndex, 0-based, into that objective's parts list), or null when none fits.

OBJECTIVES:
${JSON.stringify(rows)}

ALREADY-ANSWERED QUESTIONS:
${JSON.stringify(history)}

LECTURE PAGES:
${pagesForPrompt(pages)}

Return ONLY JSON: {"objectives":[{"objectiveId":"...","parts":[{"label":"...","quote":"...","page":1}]}],"history":[{"questionKey":"...","objectiveId":"...","partIndex":0}]}`;
}

const words = (text) => String(text || "").normalize("NFKC").toLowerCase().replace(/[\u2018\u2019\u201c\u201d"'`]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 2);

/**
 * True when the quotation's words occur close together in the source. Slide
 * extraction often interleaves two text columns, so an exact substring test
 * rejects genuine quotes; this requires ~90% of the quote's distinct words inside
 * a window about twice the quote's length.
 */
export function quoteSupported(quote, sourceText) {
  const want = [...new Set(words(quote))];
  if (want.length < 3) return false;
  const tokens = words(sourceText);
  const size = Math.max(want.length * 2 + 6, 12);
  const need = Math.ceil(want.length * 0.9);
  const wanted = new Set(want);
  const counts = new Map();
  let present = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const word = tokens[index];
    if (wanted.has(word)) { counts.set(word, (counts.get(word) || 0) + 1); if (counts.get(word) === 1) present += 1; }
    const out = tokens[index - size];
    if (index >= size && wanted.has(out)) { counts.set(out, counts.get(out) - 1); if (counts.get(out) === 0) present -= 1; }
    if (present >= need) return true;
  }
  return false;
}

/** Keep only parts whose quotation is supported by the lecture; ids are stable per label. */
export function normalizeObjectiveParts(raw, { lectureId, objectives = [], pages = [], answered = [], now = Date.now() } = {}) {
  const known = new Map(objectives.map((objective) => [objectiveKey(objective), objective]));
  const pageText = new Map(pages.map((page) => [Number(page.page), norm(page.text)]));
  const allText = norm(pages.map((page) => page.text).join(" "));
  // attempted: every objective sent, so one the model could not split is not re-requested each quiz.
  const inventory = { ...emptyPartsInventory(), lectureId, sourceVersion: partsSourceVersion(pages), legacySourceVersion: legacyPartsSourceVersion(pages), builtAt: now, attempted: [...known.keys()] };
  const partIdsByObjective = new Map();
  for (const row of Array.isArray(raw?.objectives) ? raw.objectives : []) {
    const id = String(row?.objectiveId || "");
    if (!known.has(id) || inventory.objectives[id]) continue;
    const seen = new Set();
    const parts = [];
    for (const part of Array.isArray(row.parts) ? row.parts : []) {
      const label = String(part?.label || "").trim().slice(0, 120);
      const quote = String(part?.quote || "").trim();
      const page = Number(part?.page);
      if (norm(label).length < 3 || seen.has(norm(label))) continue;
      // A misnumbered page still counts when the quote is supported elsewhere in the lecture.
      if (norm(quote).length < 12 || !(pageText.get(page)?.includes(norm(quote)) || quoteSupported(quote, pageText.get(page) || "") || quoteSupported(quote, allText))) continue;
      seen.add(norm(label));
      parts.push({ id: stableRecordId([lectureId, id, norm(label)], "part"), label, quote: quote.slice(0, 240), page: Number.isFinite(page) ? page : null });
      if (parts.length >= MAX_PARTS) break;
    }
    if (parts.length) {
      inventory.objectives[id] = { parts };
      partIdsByObjective.set(id, parts.map((part) => part.id));
    }
  }
  const answeredKeys = new Map(answered.map((question) => [question.questionKey, question.objectiveId]));
  for (const row of Array.isArray(raw?.history) ? raw.history : []) {
    const key = String(row?.questionKey || "");
    const objectiveId = String(row?.objectiveId || "");
    const ids = partIdsByObjective.get(objectiveId);
    const index = Number(row?.partIndex);
    if (!ids || answeredKeys.get(key) !== objectiveId || !Number.isInteger(index) || !ids[index]) continue;
    inventory.questionParts[evidenceKey(key)] = ids[index];
  }
  return inventory;
}

/** True when the stored inventory still matches this lecture text and covers these objectives. */
export function inventoryIsCurrent(inventory, { pages = [], objectives = [] } = {}) {
  if (!inventory || inventory.version !== PARTS_VERSION || !sourceMatches(inventory, pages)) return false;
  return objectives.every((objective) => inventory.objectives?.[objectiveKey(objective)] || inventory.attempted?.includes(objectiveKey(objective)));
}

/** Answered questions on these objectives, ready for the history-mapping prompt. */
export function answeredForParts(history = [], objectives = [], keyOf = (question) => question.poolId || question.id || question.questionId || question.questionKey) {
  const ids = new Set(objectives.map(objectiveKey));
  const out = [];
  for (const question of history) {
    if (!(Number(question?.timesAnswered) > 0 || typeof question?.lastCorrect === "boolean")) continue;
    const objectiveId = (question.objectiveIds || []).map(String).find((id) => ids.has(id));
    const key = keyOf(question);
    if (!objectiveId || !key || !question.stem) continue;
    out.push({ questionKey: String(key), objectiveId, stem: question.stem, keyed: question.choices?.[question.correct] || "", facet: question.objectiveFacet || null });
  }
  return out;
}

/** Which part an answer event tested: its own tag first, else the history mapping. */
export function partOfEvent(event, inventory) {
  return event?.objectivePartId || inventory?.questionParts?.[evidenceKey(event?.questionKey)] || null;
}

/** Per-part independent attempts and correct answers for one objective. */
export function partCoverage(inventory, objectiveId, journal = []) {
  const parts = inventory?.objectives?.[String(objectiveId)]?.parts || [];
  if (!parts.length) return [];
  const byId = new Map(parts.map((part) => [part.id, { ...part, attempts: 0, correct: 0, lastAt: null, covered: false }]));
  for (const event of journal) {
    if (typeof event?.correct !== "boolean" || !(event.objectiveIds || []).map(String).includes(String(objectiveId))) continue;
    if (!isIndependentAttempt(event)) continue;
    const row = byId.get(partOfEvent(event, inventory));
    if (!row) continue;
    row.attempts += 1;
    if (event.correct) { row.correct += 1; row.covered = true; }
    row.lastAt = Math.max(row.lastAt || 0, Number(event.at) || 0) || null;
  }
  return [...byId.values()];
}

/** Coverage summary for every objective with an inventory, keyed by objective id. */
export function partsByObjective(inventory, journal = []) {
  const out = {};
  for (const id of Object.keys(inventory?.objectives || {})) out[id] = partCoverage(inventory, id, journal);
  return out;
}

/** Untested parts first, then parts with misses, then the least recently practised. */
export function nextParts(coverage = [], limit = 3) {
  const score = (row) => (row.covered ? 2 : row.attempts ? 1 : 0);
  return [...coverage].sort((a, b) => score(a) - score(b) || (a.correct / Math.max(1, a.attempts)) - (b.correct / Math.max(1, b.attempts)) || (a.lastAt || 0) - (b.lastAt || 0)).slice(0, limit);
}

/** Attach part targets to the objectives in a quiz plan. */
export function withPartTargets(objectives = [], inventory, journal = []) {
  return objectives.map((objective) => {
    const coverage = partCoverage(inventory, objectiveKey(objective), journal);
    if (!coverage.length) return objective;
    const targets = nextParts(coverage, Math.max(1, Number(objective._targetQuestionCount) || 1));
    return { ...objective, _parts: coverage.map(({ id, label, covered }) => ({ id, label, covered })), _targetPartIds: targets.map((part) => part.id) };
  });
}

/** Writer instructions: test the listed parts and tag each item with its part id. */
export function objectivePartsPrompt(objectives = []) {
  const rows = objectives.filter((objective) => objective._parts?.length).map((objective) => ({
    objectiveId: objectiveKey(objective),
    parts: objective._parts.map((part) => ({ partId: part.id, label: part.label, tested: part.covered })),
    testNext: objective._targetPartIds || [],
  }));
  if (!rows.length) return "";
  return `OBJECTIVE PARTS (required): each objective below covers several lecture elements. Write each item on ONE part, choosing from that objective's testNext list first (untested parts before tested ones), and spread items across different parts. Return "objectivePartId" with the exact partId the item tests; it must belong to the item's objective.\n${JSON.stringify(rows)}`;
}

/** Keep a returned part id only when it belongs to the question's objective. */
export function validatedPartId(question, inventory) {
  const parts = (question?.objectiveIds || []).flatMap((objectiveId) => inventory?.objectives?.[String(objectiveId)]?.parts || []);
  if (!parts.length) return null;
  const id = question?.objectivePartId ? String(question.objectivePartId) : null;
  if (id) return parts.some((part) => part.id === id) ? id : null;
  // A reviewer's replacement can drop the tag; recover it from the facet label
  // only when one part clearly matches (most of its words appear in the facet).
  const words = (text) => new Set(norm(text).split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  const facet = words(`${question.objectiveFacet || ""} ${question.topic || ""}`);
  if (!facet.size) return null;
  const scored = parts.map((part) => {
    const label = words(part.label);
    const hits = [...label].filter((word) => facet.has(word)).length;
    return { id: part.id, share: label.size ? hits / label.size : 0 };
  }).sort((a, b) => b.share - a.share);
  return scored[0].share >= 0.6 && (scored.length === 1 || scored[1].share < scored[0].share) ? scored[0].id : null;
}
