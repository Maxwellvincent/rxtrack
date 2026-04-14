/**
 * Adaptive Difficulty Engine for rxtrack
 *
 * Computes the correct difficulty tier for MCQ generation based on:
 *   - Session count (how many times a lecture has been studied)
 *   - Last session score
 *   - Within-session correct streak (hot streak bumps tier up)
 *
 * Tiers: foundational → developing → advanced → exam
 * Each tier controls Bloom's distribution, vignette complexity, and reasoning depth.
 */

// ─── Tier Definitions ────────────────────────────────────────────────────────

export const DIFFICULTY_TIERS = {
  foundational: {
    label: "Foundational",
    level: 1,
    bloomRange: [1, 2],
    bloomMix:
      "80% Bloom 1-2 (recall/understand), 20% Bloom 3 (apply). " +
      "Focus: define terms, identify structures, recall normal values.",
    questionStyle:
      "Short clinical vignettes (2-3 sentences). Single-step reasoning. " +
      "Patient presents with X — what is the structure/term/mechanism? " +
      "Wrong answers should be adjacent terms, not complex clinical scenarios.",
  },
  developing: {
    label: "Developing",
    level: 2,
    bloomRange: [2, 3],
    bloomMix:
      "30% Bloom 1-2, 50% Bloom 3 (apply), 20% Bloom 4 (analyze). " +
      "Focus: connect mechanism to presentation, apply concepts to patient.",
    questionStyle:
      "Standard clinical vignettes (3-4 sentences). One-step mechanism application. " +
      "Patient presents → what mechanism explains this finding? " +
      "Distractors should be plausible mechanisms that require active reasoning to eliminate.",
  },
  advanced: {
    label: "Advanced",
    level: 3,
    bloomRange: [3, 5],
    bloomMix:
      "10% Bloom 1-2, 40% Bloom 3-4 (apply/analyze), 50% Bloom 5-6 (evaluate/create). " +
      "Focus: differentiate similar conditions, predict downstream effects, reason through exceptions.",
    questionStyle:
      "Dense clinical vignettes (4-5 sentences) with vitals, labs, and exam findings. " +
      "Two-step reasoning required: patient → interpret findings → identify mechanism or next step. " +
      "At least one question per set should involve a lab value that must be interpreted in context. " +
      "Distractors test adjacent, high-yield concepts — plausible and education-rich when wrong.",
  },
  exam: {
    label: "Exam-Ready",
    level: 4,
    bloomRange: [4, 6],
    bloomMix:
      "100% Bloom 4-6 (analyze/evaluate/create). No recall-level questions. " +
      "Focus: USMLE Step 1 multi-step reasoning, cross-concept integration, clinical decision-making.",
    questionStyle:
      "USMLE Step 1 style vignettes (4-6 sentences). Third-order reasoning required: " +
      "patient presents → lab/exam must be interpreted → underlying mechanism identified → " +
      "which treatment/finding/consequence follows? " +
      "At least 2 of 5 questions must require integrating knowledge from a related concept area. " +
      "Distractors must test high-yield adjacent mechanisms — wrong answers should teach, not mislead. " +
      "Every stem must contain enough information that a test-taker who truly understands will get it right " +
      "and one who is guessing will not.",
  },
};

// ─── Core Computation ─────────────────────────────────────────────────────────

/**
 * Compute the difficulty tier for a lecture session.
 *
 * @param {object|null} perf  - Performance object from rxt-performance keyed by `lecId__blockId`
 * @param {number} sessionStreak - Consecutive correct answers in the current session (default 0)
 * @returns {{ tier, level, label, bloomRange, bloomMix, questionStyle, sessionCount, lastScore }}
 */
export function computeDifficultyTier(perf, sessionStreak = 0) {
  // Normalize session count
  const sessionsArr = Array.isArray(perf?.sessions) ? perf.sessions : [];
  const sessionCount =
    typeof perf?.sessions === "number" && !Number.isNaN(perf.sessions)
      ? perf.sessions
      : sessionsArr.length;

  // Normalize last score
  const rawScore =
    perf?.lastScore ?? perf?.score ?? (sessionsArr.length ? sessionsArr[sessionsArr.length - 1]?.score : null);
  const lastScore = rawScore != null && Number.isFinite(Number(rawScore)) ? Number(rawScore) : null;

  // ── Base tier from session count + score ────────────────────────────────
  // Compressed curve for fast-paced schedules (2 lectures/day, 3-4 week blocks).
  // Most lectures will only see 2-4 sessions — score is the primary driver;
  // session count acts as a light guardrail to prevent jumping to exam on session 1.
  let baseTierIndex;

  if (sessionCount === 0 || lastScore === null) {
    // First session ever — always start foundational regardless of anything
    baseTierIndex = 0;
  } else if (sessionCount <= 1 || lastScore < 50) {
    // Second session or struggling (<50%) — still foundational, reinforce basics
    baseTierIndex = 0;
  } else if (sessionCount <= 2 || lastScore < 65) {
    // Session 2 with passing score, or session 3 — developing
    baseTierIndex = 1;
  } else if (sessionCount <= 3 || lastScore < 80) {
    // Session 3 scoring well, or session 4 — advanced
    baseTierIndex = 2;
  } else {
    // Session 4+ scoring 80%+ — exam ready
    baseTierIndex = 3;
  }

  // ── Streak bonus: hot streak bumps one tier, cold streak drops one ───────
  const streakBonus = sessionStreak >= 5 ? 2 : sessionStreak >= 3 ? 1 : sessionStreak <= -3 ? -1 : 0;
  const tierIndex = Math.max(0, Math.min(3, baseTierIndex + streakBonus));

  const tierKeys = ["foundational", "developing", "advanced", "exam"];
  const tierKey = tierKeys[tierIndex];

  return {
    tier: tierKey,
    sessionCount,
    lastScore,
    ...DIFFICULTY_TIERS[tierKey],
  };
}

/**
 * Convenience: return just the difficulty label string for storing in session records.
 * Replaces the hardcoded "medium" everywhere.
 *
 * @param {object|null} perf
 * @returns {"foundational"|"developing"|"advanced"|"exam"}
 */
export function computeDifficultyLabel(perf) {
  return computeDifficultyTier(perf).tier;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Build the difficulty instruction block to inject into MCQ generation prompts.
 * Replaces the hardcoded Bloom% rules in DeepLearn.jsx.
 *
 * @param {{ tier, label, bloomMix, questionStyle, sessionCount, lastScore }} tierInfo
 * @returns {string}
 */
export function buildDifficultyInstruction(tierInfo) {
  const { tier, label, bloomMix, questionStyle, sessionCount, lastScore } = tierInfo;

  const scoreStr = lastScore != null ? `${Math.round(lastScore)}%` : "no prior score";
  const sessionStr =
    sessionCount === 0
      ? "first session"
      : `${sessionCount} session${sessionCount !== 1 ? "s" : ""} completed`;

  const lines = [
    `DIFFICULTY TIER: ${label.toUpperCase()} (${sessionStr}, last score: ${scoreStr})`,
    `Bloom's distribution: ${bloomMix}`,
    `Question style: ${questionStyle}`,
  ];

  if (tier === "exam") {
    lines.push(
      ``,
      `USMLE STEP 1 ESCALATION ACTIVE — additional rules:`,
      `- Every question must require at least 2 reasoning steps to answer correctly`,
      `- At least 2 of 5 questions must integrate a second concept area (e.g. if testing hemostasis, one question should require coagulation cascade knowledge to eliminate a distractor)`,
      `- Vignette length: minimum 4 sentences, information-dense with vitals + labs`,
      `- Distractors must be high-yield concepts in their own right — wrong answers should teach`,
      `- No "obvious" wrong answers — every option should be something a weak student might choose`
    );
  } else if (tier === "advanced") {
    lines.push(
      ``,
      `ADVANCED TIER RULES:`,
      `- At least one question must require lab value interpretation`,
      `- At least one question must test a downstream consequence or exception`,
      `- Distractors must represent common Step 1 misconceptions about this topic`
    );
  }

  return lines.join("\n");
}

// ─── Session Streak Helpers ───────────────────────────────────────────────────

/**
 * Update the session streak counter after each MCQ answer.
 * Correct answer increments streak; wrong answer resets to 0.
 *
 * @param {number} current - Current streak value
 * @param {boolean} wasCorrect
 * @returns {number} New streak value
 */
export function updateSessionStreak(current, wasCorrect) {
  if (wasCorrect) return current + 1;
  return 0;
}
