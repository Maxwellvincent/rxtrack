// Where a school question bank should be linked. A bank's questions usually
// come from one place: homework from one lecture or week, an IMCQ from one
// week, an ESoft quiz from a 2–3 week span. Each question's best lexical
// lecture match is a vote; the votes pick the bank's home block (a bank filed
// under CBSE Prep, or under the wrong block, still links to the block that
// taught it) and its focus week(s). Votes only narrow where linking looks
// first; every objective link still needs the two-pass source-quoted review.

import { rankLectureContent } from "./lectureContentMatch.js";
import { fridayWeekKey } from "./weekScope.js";
import { supplementaryObjective } from "./objectives.js";

const MIN_VOTES = 3;

/** School week of a lecture: stored week number, else its Monday–Friday week. */
export function schoolWeekKey(lecture) {
  if (lecture?.weekNumber != null && Number.isFinite(Number(lecture.weekNumber))) return `w${Number(lecture.weekNumber)}`;
  const date = lecture?.lectureDate || lecture?.date;
  return date ? fridayWeekKey(date) : null;
}

/** School format from the bank's filename and source kind. */
export function bankFormat(filename = "", sourceKind = "") {
  const name = String(filename);
  if (/\bE[\s-]?SOFT\b/i.test(name)) return "esoft";
  if (/\bIMCQ\b/i.test(name) || sourceKind === "imcq") return "imcq";
  if (sourceKind === "homework" || /\b(?:homework|practice questions?|class questions)\b/i.test(name)) return "homework";
  return "other";
}

function weekOrder(blockLectures) {
  return [...new Set(blockLectures.map(schoolWeekKey).filter(Boolean))]
    .sort((a, b) => (a.startsWith("w") && b.startsWith("w") ? Number(a.slice(1)) - Number(b.slice(1)) : a.localeCompare(b)));
}

/** Best window of `size` consecutive weeks by votes. */
function bestWindow(order, votes, size) {
  let best = null;
  for (let start = 0; start < order.length; start++) {
    const weeks = order.slice(start, start + size);
    const total = weeks.reduce((sum, week) => sum + (votes.get(week) || 0), 0);
    if (!best || total > best.total) best = { weeks, total };
  }
  return best || { weeks: [], total: 0 };
}

/**
 * `{ homeBlockId, focusLectureIds, focusWeeks, votes, format }`.
 * `lectures` are every candidate lecture with text (chunks/atoms);
 * `candidateBlockIds` limits where a bank may be homed.
 */
export function bankMappingScope({ filename = "", sourceKind = "", bankBlockId = null, questions = [], lectures = [], candidateBlockIds = null } = {}) {
  const format = bankFormat(filename, sourceKind);
  const pool = (lectures || []).filter(lecture => lecture?.id && !lecture.mergedInto && !supplementaryObjective(lecture)
    && lecture.blockId && lecture.blockId !== "cbse-prep" && (!candidateBlockIds || candidateBlockIds.includes(lecture.blockId)));
  const byId = Object.fromEntries(pool.map(lecture => [lecture.id, lecture]));
  // Soft votes: each question spreads one vote over its top lexical matches,
  // weighted by score. A confirmed or verified link is a full, double vote.
  const blockVotes = new Map();
  const lectureVotes = new Map();
  let voters = 0;
  const add = (lecture, weight) => {
    blockVotes.set(lecture.blockId, (blockVotes.get(lecture.blockId) || 0) + weight);
    lectureVotes.set(lecture.id, (lectureVotes.get(lecture.id) || 0) + weight);
  };
  for (const question of questions || []) {
    if (!question?.stem) continue;
    const known = question.lectureId && byId[question.lectureId] && ["user-confirmed", "evidence-verified", "user-lecture-only"].includes(question.curriculumLinkStatus) ? byId[question.lectureId] : null;
    if (known) { add(known, 2); voters++; continue; }
    const top = rankLectureContent({ ...question, sourceTitle: filename }, pool, null).slice(0, 5).filter(row => row.contentScore > 0);
    const total = top.reduce((sum, row) => sum + row.score, 0);
    if (!total || top[0].bodyEvidence.length < 2) continue;
    voters++;
    for (const row of top) add(row.lecture, row.score / total);
  }
  const ranked = [...blockVotes].sort((a, b) => b[1] - a[1]);
  const bankBlockHasLectures = pool.some(lecture => lecture.blockId === bankBlockId);
  // Keep the filed block unless another block clearly taught the bank.
  let homeBlockId = bankBlockHasLectures ? bankBlockId : ranked[0]?.[0] || null;
  const homeVotes = blockVotes.get(homeBlockId) || 0;
  if (ranked[0] && ranked[0][0] !== homeBlockId && voters >= MIN_VOTES && ranked[0][1] >= Math.max(MIN_VOTES, 0.25 * voters) && ranked[0][1] >= 2 * homeVotes) homeBlockId = ranked[0][0];
  const blockLectures = pool.filter(lecture => lecture.blockId === homeBlockId);
  const votes = new Map();
  for (const lecture of blockLectures) {
    const week = schoolWeekKey(lecture);
    if (week && lectureVotes.get(lecture.id)) votes.set(week, (votes.get(week) || 0) + lectureVotes.get(lecture.id));
  }
  const voteTotal = [...votes.values()].reduce((sum, value) => sum + value, 0);
  const round = value => Math.round(value * 10) / 10;
  const order = weekOrder(blockLectures);
  let focusWeeks = [];
  if (voters >= MIN_VOTES && voteTotal >= MIN_VOTES) {
    const size = format === "esoft" ? 3 : 1;
    const window = bestWindow(order, votes, size);
    const share = window.total / voteTotal;
    if ((format === "imcq" || format === "homework") && share >= 0.4) focusWeeks = window.weeks;
    else if (format === "esoft" && share >= 0.55) focusWeeks = window.weeks.filter(week => (votes.get(week) || 0) >= 0.1 * voteTotal);
    else if (format === "other" && share >= 0.6) focusWeeks = window.weeks;
  }
  const focusLectureIds = blockLectures.filter(lecture => focusWeeks.includes(schoolWeekKey(lecture))).map(lecture => lecture.id);
  return { format, homeBlockId, focusWeeks, focusLectureIds, votes: Object.fromEntries([...votes].map(([week, value]) => [week, round(value)])), voteTotal: round(voteTotal), voters, blockVotes: Object.fromEntries([...blockVotes].map(([block, value]) => [block, round(value)])) };
}
