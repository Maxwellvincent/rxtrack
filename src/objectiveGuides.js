/**
 * Study-guide text per Bloom level.
 *
 * These four strings used to be stored on every objective — 2346 copies of ten
 * distinct sentences, 407KB of a ~5MB localStorage budget. They are a pure
 * function of the objective's bloom_level, so they live here instead and
 * `guideFor` fills them in at read time.
 *
 * An objective that carries its own value still wins: a handful of older rows
 * hold non-canonical text, and compaction leaves those in place.
 */
export const OBJECTIVE_GUIDES = {
  pre_lecture_guide: {
    1: "Skim and define the term. Just know it exists.",
    2: "Read the section. Try to explain it out loud after.",
    3: "Read and note the steps. Full mastery comes after lecture.",
    4: "Build a rough comparison table. Lecture will sharpen it.",
    5: "Read for exposure only. Flag this — revisit post-lecture.",
    6: "Read for exposure only. Flag this — revisit post-lecture.",
  },
  post_lecture_guide: {
    1: "Can you write the definition from memory?",
    2: "Explain it in plain language without notes.",
    3: "Work a practice problem or clinical scenario.",
    4: "Complete your comparison table. Can you distinguish without prompts?",
    5: "Justify the answer. Why is one option better than another?",
    6: "Can you construct or design the thing from scratch?",
  },
  sg_guide: {
    1: "Should be automatic by now.",
    2: "Be ready to explain to a peer.",
    3: "Be ready to apply in a group case.",
    4: "Be ready to defend your comparison to the group.",
    5: "Bring your reasoning — group will challenge it.",
    6: "Be ready to walk through your constructed answer.",
  },
  dla_guide: {
    1: "Master this independently — no lecture is coming.",
    2: "Write a full explanation in your own words before moving on.",
    3: "Apply it to a practice problem before moving on.",
    4: "Build the full comparison. Do not move on until you can differentiate.",
    5: "Work through a clinical vignette and defend your reasoning.",
    6: "Construct or formulate the full answer independently.",
  },
};

export const GUIDE_FIELDS = Object.keys(OBJECTIVE_GUIDES);

/** Stored value first, then the Bloom-level default, then null. */
export function guideFor(objective, field) {
  const stored = objective?.[field];
  if (stored) return stored;
  return OBJECTIVE_GUIDES[field]?.[objective?.bloom_level] ?? null;
}

/** True when the stored value is exactly what `guideFor` would supply anyway. */
export function isDefaultGuide(objective, field) {
  const stored = objective?.[field];
  if (!stored) return false;
  return stored === OBJECTIVE_GUIDES[field]?.[objective?.bloom_level];
}
