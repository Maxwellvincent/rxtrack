// Cross-lecture integration items for exam practice. A question stays owned
// by one objective in its primary lecture (so allocation, ownership and the
// key-blind solve are unchanged); the partner lecture only supplies the second
// taught rule. Acceptance requires reviewed source quotes from both lectures.

import { fridayWeekKey } from "../../logic/weekScope.js";

export const CROSS_LECTURE_SHARE = 0.25;
const MIN_QUOTE_LENGTH = 20;
const PARTNER_TEXT_BUDGET = 18000;

// School week: the stored week number, else the Monday–Friday week of the
// lecture date (as a day count, so weeks still sort and compare).
const weekOf = lecture => {
  if (lecture?.weekNumber != null && Number.isFinite(Number(lecture.weekNumber))) return Number(lecture.weekNumber);
  const date = lecture?.lectureDate || lecture?.date;
  return date ? Date.parse(`${fridayWeekKey(date)}T00:00:00Z`) / 86400000 : null;
};
const numberOf = lecture => {
  const value = Number(lecture?.lectureNumber);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
};

const pairKey = (a, b) => [String(a), String(b)].sort().join("|");

/**
 * Evidence that two lectures belong together: school questions already linked
 * to both (strongest), key terms the lectures share, and how many of the
 * partner's objectives are weak or untested (practice where it is needed).
 */
export function partnerSignals({ termIndex = null, schoolQuestions = [], objectivesByLecture = {}, evidenceObjectives = {} } = {}) {
  const schoolPairs = new Map();
  for (const question of schoolQuestions || []) {
    const primary = question?.lectureId;
    for (const other of question?.secondaryLectureIds || []) {
      if (!primary || !other || other === primary) continue;
      const key = pairKey(primary, other);
      schoolPairs.set(key, (schoolPairs.get(key) || 0) + 1);
    }
  }
  const sharedTerms = new Map();
  for (const entry of Object.values(termIndex || {})) {
    const ids = [...new Set(entry?.lectureIds || [])];
    // A term in most of the block is generic, not a link.
    if (ids.length < 2 || ids.length > 6) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const key = pairKey(ids[i], ids[j]);
      sharedTerms.set(key, (sharedTerms.get(key) || 0) + 1);
    }
  }
  const weakObjectives = {};
  for (const [lectureId, objectives] of Object.entries(objectivesByLecture || {})) {
    weakObjectives[lectureId] = (objectives || []).filter(objective => {
      const record = evidenceObjectives?.[objective?.id];
      const attempts = Number(record?.attempts) || 0;
      return attempts === 0 || (Number(record?.correct) || 0) / attempts < 0.7;
    }).length;
  }
  return { schoolPairs, sharedTerms, weakObjectives };
}

function partnerScore(signals, primary, candidate) {
  if (!signals) return 0;
  const key = pairKey(primary, candidate);
  return 3 * Math.min(3, signals.schoolPairs?.get(key) || 0)
    + Math.min(5, signals.sharedTerms?.get(key) || 0)
    + Math.min(3, signals.weakObjectives?.[candidate] || 0);
}

/**
 * Pair each lecture with a partner. `window: "same-week"` (IMCQ) keeps the
 * partner in the lecture's week, else the nearest lecture; `window: "scope"`
 * (ESoft) allows any candidate lecture in the chosen span. Within the window,
 * school-linked pairs, shared key terms and weak partner objectives rank
 * first; ties go to the nearest lecture, later before earlier.
 */
export function crossLecturePartners(lectureIds = [], lecturesById = {}, { candidateIds = null, window = "same-week", signals = null } = {}) {
  const partners = new Map();
  const primaries = [...new Set(lectureIds)].filter(id => lecturesById[id]);
  const ordered = [...new Set([...primaries, ...(candidateIds || [])])].filter(id => lecturesById[id])
    .sort((a, b) => (weekOf(lecturesById[a]) ?? Infinity) - (weekOf(lecturesById[b]) ?? Infinity)
      || numberOf(lecturesById[a]) - numberOf(lecturesById[b]) || String(a).localeCompare(String(b)));
  if (ordered.length < 2) return partners;
  for (const id of primaries) {
    const index = ordered.indexOf(id);
    const week = weekOf(lecturesById[id]);
    let pool = ordered.filter(other => other !== id);
    if (window !== "scope") {
      const sameWeek = pool.filter(other => week !== null && weekOf(lecturesById[other]) === week);
      if (sameWeek.length) pool = sameWeek;
      else {
        const nearest = ordered[index - 1] ?? ordered[index + 1];
        pool = nearest ? [nearest] : [];
      }
    }
    if (!pool.length) continue;
    const ranked = pool.map(other => {
      const distance = ordered.indexOf(other) - index;
      const sameWeekBonus = window === "scope" && week !== null && weekOf(lecturesById[other]) === week ? 1 : 0;
      return { other, score: partnerScore(signals, id, other) + sameWeekBonus, distance: Math.abs(distance), later: distance > 0 ? 0 : 1 };
    }).sort((a, b) => b.score - a.score || a.distance - b.distance || a.later - b.later);
    partners.set(id, ranked[0].other);
  }
  return partners;
}

/** A share of a lecture's slots (a quarter by default), never every slot. */
export function crossLectureCount(requested, share = CROSS_LECTURE_SHARE) {
  const count = Math.max(0, Math.floor((Number(requested) || 0) * share));
  return count >= requested ? Math.max(0, requested - 1) : count;
}

export function combinedLectureText(primaryText, partner = {}, budget = PARTNER_TEXT_BUDGET) {
  const partnerText = String(partner.text || "").slice(0, budget);
  if (!partnerText.trim()) return primaryText;
  return `${primaryText}\f\nPARTNER LECTURE — ${partner.title || "partner lecture"} (source data for the second rule only)\n${partnerText}`;
}

export function crossLectureFocusNotes(primaryTitle, partnerTitle, partnerObjectives = []) {
  const listed = (partnerObjectives || []).filter(objective => objective?.id).slice(0, 25)
    .map(objective => ({ id: objective.id, objective: String(objective.objective || objective.text || "").slice(0, 160) }));
  const partnerContract = listed.length
    ? ` In questionPlan set partnerObjectiveId to the ONE id below whose taught content rule 2 comes from (or null if none fits). Partner lecture objectives: ${JSON.stringify(listed)}`
    : "";
  return `CROSS-LECTURE INTEGRATION (school IMCQ/ESoft style): Write each item for one assigned objective of ${primaryTitle}, but require a second taught rule from the partner lecture ${partnerTitle}. Rule 1 must come from ${primaryTitle}; rule 2 from ${partnerTitle}; they must join through ONE shared structure, process or finding that the stem does not state. Both rules must be necessary: removing either must leave a plausible alternative unresolved. Include one exact quote from each lecture in questionPlan.sourceQuotes. Do not merely mention both topics, pair two unrelated facts, or import facts absent from both lectures. If the two lectures share no genuine connection for this objective, return a shortfall instead.${partnerContract}`;
}

/** The partner objective a verified item may also credit, only if it is real. */
export function validatedPartnerObjectiveId(question = {}, partnerObjectives = []) {
  const claimed = question?.questionPlan?.partnerObjectiveId;
  if (!claimed) return null;
  const match = (partnerObjectives || []).find(objective => objective?.id === claimed || (objective?.code && objective.code === claimed));
  return match?.id || null;
}

const normalize = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Reviewed quotes (reasoning audit / blind solve) must cover both lectures. */
export function verifiedCrossLectureQuotes(question = {}, primaryText = "", partnerText = "") {
  const reviewed = [...(question.reasoningAudit?.sourceQuotes || []), ...(question.qualityAudit?.blindSolve?.sourceQuotes || [])]
    .map(normalize).filter(quote => quote.length >= MIN_QUOTE_LENGTH);
  const primary = normalize(primaryText), partner = normalize(partnerText);
  if (!primary || !partner) return false;
  const inPrimary = reviewed.filter(quote => primary.includes(quote) && !partner.includes(quote));
  const inPartner = reviewed.filter(quote => partner.includes(quote) && !primary.includes(quote));
  return inPrimary.length > 0 && inPartner.length > 0;
}
