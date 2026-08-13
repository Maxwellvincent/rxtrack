/**
 * Pure graduation logic: given a lecture's session history + exam pressure,
 * decide what objective status the lecture's last completed round warrants.
 *
 * Session shape: { score: 0-100, avgConfidence: 0-1, hasLandmines: bool, at: ISO string }
 *
 * Gates compress as the exam approaches so you can still earn mastery even with
 * only days left. A comprehensive (semester) exam date re-opens the mastered
 * status for review regardless of block exam outcome.
 */

const DAY_MS = 1000 * 60 * 60 * 24;

function daysBetween(from, to) {
  if (!from || !to) return Infinity;
  return Math.round((new Date(to) - new Date(from)) / DAY_MS);
}

function daysUntil(examDateStr, now = new Date()) {
  if (!examDateStr) return Infinity;
  return Math.max(0, daysBetween(now, examDateStr));
}

/**
 * Compute the target objective status after completing a quiz round.
 *
 * @param {object} opts
 * @param {Array}  opts.sessions          - all sessions for this lecture (newest first preferred)
 * @param {string} opts.blockExamDate     - YYYY-MM-DD block exam date
 * @param {string} opts.comprehensiveExamDate - YYYY-MM-DD semester comp exam (optional)
 * @param {string} opts.currentStatus     - current objective status
 * @param {Date}   opts.now               - reference date (default: new Date())
 * @returns {"developing"|"mastered"|"struggling"|null} null = no change
 */
export function computeTargetStatus({
  sessions = [],
  blockExamDate,
  comprehensiveExamDate,
  currentStatus,
  now = new Date(),
}) {
  if (!sessions.length) return null;

  const latest = sessions[0]; // caller puts newest first
  const score = latest.score ?? 0;
  const avgConf = latest.avgConfidence ?? 0;
  const landmine = !!latest.hasLandmines;

  // ── Struggling detection ────────────────────────────────────────────────
  // Score below floor OR high confidence with wrong answers = dangerous gap
  const isFloor = score < 60;
  const isDangerousLandmine = landmine && avgConf > 0.65 && score < 70;
  if (isFloor || isDangerousLandmine) return "struggling";

  // ── Struggling → developing recovery ───────────────────────────────────
  if (currentStatus === "struggling") {
    return score >= 70 ? "developing" : null;
  }

  // ── Mastery gates (compressed by exam pressure) ─────────────────────────
  const daysToBlock = daysUntil(blockExamDate, now);
  const daysToComp = daysUntil(comprehensiveExamDate, now);
  const effectiveDays = Math.min(daysToBlock, daysToComp);

  // Already mastered — only re-open if comprehensive exam is approaching
  // and the lecture hasn't been touched in > 14 days
  if (currentStatus === "mastered") {
    if (comprehensiveExamDate && daysToComp < 30) {
      const lastAt = sessions[0]?.at;
      const daysSinceReview = lastAt ? daysBetween(lastAt, now) : 999;
      if (daysSinceReview > 14) return "developing"; // force one more pass before comp
    }
    return null;
  }

  const n = sessions.length;

  // Crunch: < 7 days — single session, high bar
  if (effectiveDays < 7) {
    return score >= 85 && avgConf >= 0.7 ? "mastered" : "developing";
  }

  // Tight: 7–13 days — two sessions, no interval requirement
  if (effectiveDays < 14) {
    if (n < 2) return "developing";
    return score >= 80 && avgConf >= 0.6 ? "mastered" : "developing";
  }

  // Medium: 14–20 days — two sessions ≥ 3 days apart
  if (effectiveDays < 21) {
    if (n < 2) return "developing";
    const gap = sessions.length >= 2 ? daysBetween(sessions[1].at, sessions[0].at) : 0;
    if (gap < 3) return "developing";
    return score >= 80 && avgConf >= 0.6 ? "mastered" : "developing";
  }

  // Full: ≥ 21 days — three sessions, last two ≥ 7 days apart
  if (n < 3) return "developing";
  const gap = sessions.length >= 2 ? daysBetween(sessions[1].at, sessions[0].at) : 0;
  if (gap < 7) return "developing";
  return score >= 80 && avgConf >= 0.6 ? "mastered" : "developing";
}
