// Cross-lecture integration items for exam practice. A question stays owned
// by one objective in its primary lecture (so allocation, ownership and the
// key-blind solve are unchanged); the partner lecture only supplies the second
// taught rule. Acceptance requires reviewed source quotes from both lectures.

export const CROSS_LECTURE_SHARE = 0.25;
const MIN_QUOTE_LENGTH = 20;
const PARTNER_TEXT_BUDGET = 18000;

const weekOf = lecture => {
  const week = Number(lecture?.weekNumber);
  return Number.isFinite(week) ? week : null;
};
const numberOf = lecture => {
  const value = Number(lecture?.lectureNumber);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
};

/** Pair each lecture with a same-week neighbour, else the nearest lecture. */
export function crossLecturePartners(lectureIds = [], lecturesById = {}) {
  const partners = new Map();
  const ordered = [...new Set(lectureIds)].filter(id => lecturesById[id])
    .sort((a, b) => (weekOf(lecturesById[a]) ?? Infinity) - (weekOf(lecturesById[b]) ?? Infinity)
      || numberOf(lecturesById[a]) - numberOf(lecturesById[b]) || String(a).localeCompare(String(b)));
  if (ordered.length < 2) return partners;
  ordered.forEach((id, index) => {
    const week = weekOf(lecturesById[id]);
    const sameWeek = ordered.filter(other => other !== id && week !== null && weekOf(lecturesById[other]) === week);
    if (sameWeek.length) {
      const next = sameWeek.find(other => ordered.indexOf(other) > index);
      partners.set(id, next || sameWeek[sameWeek.length - 1]);
      return;
    }
    partners.set(id, ordered[index + 1] && weekOf(lecturesById[ordered[index + 1]]) === week ? ordered[index + 1] : ordered[index - 1] ?? ordered[index + 1]);
  });
  return partners;
}

/** About a quarter of a lecture's slots, never every slot. */
export function crossLectureCount(requested, share = CROSS_LECTURE_SHARE) {
  const count = Math.max(0, Math.floor((Number(requested) || 0) * share));
  return count >= requested ? Math.max(0, requested - 1) : count;
}

export function combinedLectureText(primaryText, partner = {}, budget = PARTNER_TEXT_BUDGET) {
  const partnerText = String(partner.text || "").slice(0, budget);
  if (!partnerText.trim()) return primaryText;
  return `${primaryText}\f\nPARTNER LECTURE — ${partner.title || "partner lecture"} (source data for the second rule only)\n${partnerText}`;
}

export function crossLectureFocusNotes(primaryTitle, partnerTitle) {
  return `CROSS-LECTURE INTEGRATION (school IMCQ/ESoft style): Write each item for one assigned objective of ${primaryTitle}, but require a second taught rule from the partner lecture ${partnerTitle}. Rule 1 must come from ${primaryTitle}; rule 2 from ${partnerTitle}; they must join through ONE shared structure, process or finding that the stem does not state. Both rules must be necessary: removing either must leave a plausible alternative unresolved. Include one exact quote from each lecture in questionPlan.sourceQuotes. Do not merely mention both topics, pair two unrelated facts, or import facts absent from both lectures. If the two lectures share no genuine connection for this objective, return a shortfall instead.`;
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
