// Active recall before the choices ("cover the options"). In untimed practice
// the stem shows first; the learner commits an answer and the linking reason
// in their own words, then the choices appear. After the reveal they compare
// their reason with the question's own reasoning chain and mark it matched or
// missed. Nothing here calls a model: the comparison is a self-check.

export const COVER_PREF_KEY = "rxt-cover-options-v1";
export const MAX_PREDICTION_LENGTH = 600;

/** Read the per-viewer preference; covering is on unless turned off. */
export function readCoverPreference(storage = globalThis.localStorage) {
  try { return storage?.getItem(COVER_PREF_KEY) !== "off"; } catch { return true; }
}

export function writeCoverPreference(on, storage = globalThis.localStorage) {
  try { storage?.setItem(COVER_PREF_KEY, on ? "on" : "off"); } catch { /* Optional per-viewer preference. */ }
}

/**
 * Whether this question's choices stay hidden until the learner commits a
 * prediction. Only untimed practice, only before any answer is picked, and
 * never once a prediction (or a skip) is on record.
 */
export function shouldCoverOptions({ session, question, picked = null, enabled = true } = {}) {
  if (!enabled || !question || !session) return false;
  if (session.format !== "practice" || session.status !== "in_progress") return false;
  if (picked != null) return false;
  if (!question.choices || !Object.keys(question.choices).length) return false;
  if (question.sourceVisualChoicesUnverified && !question.sourceVisualLabelsConfirmed) return false;
  const entry = question.coverAnswer;
  return !(entry && (entry.prediction || entry.skipped));
}

const firstSentence = text => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = /^(.{20,320}?[.!?])(\s|$)/.exec(clean);
  return match ? match[1] : clean.slice(0, 320);
};

/**
 * The question's own reasoning chain, as short lines to compare against.
 * Generated items carry a question plan; school items fall back to the first
 * sentence of the explanation.
 */
export function keyReasoning(question = {}) {
  const plan = question.questionPlan || {};
  const lines = [];
  const add = (label, value) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text && !lines.some(line => line.text === text)) lines.push({ label, text });
  };
  add("Link", plan.inference || plan.relationship || plan.changedRelationship);
  add("Deciding clue", plan.discriminator);
  if (question.crossLecture?.partnerTitle) add("Second lecture", question.crossLecture.partnerTitle);
  if (!lines.some(line => line.label === "Link")) add("Key point", firstSentence(question.explanation));
  return lines;
}

/** The stored record, trimmed and timestamped. */
export function coverAnswerEntry(previous = {}, patch = {}, now = Date.now()) {
  const next = { ...(previous || {}) };
  if (typeof patch.prediction === "string") next.prediction = patch.prediction.trim().slice(0, MAX_PREDICTION_LENGTH);
  if (patch.skipped) next.skipped = true;
  if (patch.selfCheck === "matched" || patch.selfCheck === "missed") next.selfCheck = patch.selfCheck;
  next.at = now;
  return next;
}

/** Evidence field for one answer: did they commit a prediction first. */
export function coverAnswerEvidence(question = {}) {
  const entry = question.coverAnswer;
  return entry ? { recallAttempted: Boolean(entry.prediction) } : {};
}

/** Objectives a self-check speaks to: the owner plus any verified partner. */
export function selfCheckObjectiveIds(question = {}) {
  return [...new Set([...(question.objectiveIds || []), ...(question.secondaryObjectiveIds || [])])].filter(Boolean);
}

/** Self-check counts across answered questions, for a session summary. */
export function selfCheckSummary(questions = []) {
  const attempted = questions.filter(q => q?.coverAnswer?.prediction);
  return {
    predicted: attempted.length,
    matched: attempted.filter(q => q.coverAnswer.selfCheck === "matched").length,
    missed: attempted.filter(q => q.coverAnswer.selfCheck === "missed").length,
  };
}
