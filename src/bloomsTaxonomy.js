// src/bloomsTaxonomy.js

const BLOOM_VERBS = {
  1: ["define", "list", "name", "recall", "recognize", "identify", "label", "state", "enumerate", "indicate"],
  2: ["describe", "explain", "summarize", "discuss", "outline", "review", "clarify", "give", "note", "highlight"],
  3: ["apply", "use", "calculate", "demonstrate", "predict", "determine", "estimate", "correlate", "interpret"],
  4: ["analyze", "compare", "contrast", "differentiate", "distinguish", "examine", "relate", "classify", "categorize"],
  5: ["evaluate", "justify", "critique", "assess", "argue", "defend", "prioritize", "propose"],
  6: ["create", "design", "construct", "develop", "formulate", "plan", "produce", "prepare"],
};

const LEVEL_NAMES = {
  1: "Remember",
  2: "Understand",
  3: "Apply",
  4: "Analyze",
  5: "Evaluate",
  6: "Create",
};

const LEVEL_COLORS = {
  1: "#6b7280", // gray   — Remember
  2: "#0891b2", // teal   — Understand
  3: "#2563eb", // blue   — Apply
  4: "#7c3aed", // purple — Analyze
  5: "#d97706", // orange — Evaluate
  6: "#dc2626", // red    — Create
};

const LEVEL_BG = {
  1: "#6b728015",
  2: "#0891b215",
  3: "#2563eb15",
  4: "#7c3aed15",
  5: "#d9770615",
  6: "#dc262615",
};

export function getBloomLevel(objectiveText) {
  if (!objectiveText)
    return { level: 2, levelName: "Understand", matchedVerb: "unknown" };

  const textLower = objectiveText.toLowerCase().trim();
  const firstWord = textLower.split(/\s+/)[0] || "";

  for (const level of [1, 2, 3, 4, 5, 6]) {
    for (const verb of BLOOM_VERBS[level]) {
      if (firstWord === verb || textLower.startsWith(verb + " ")) {
        return { level, levelName: LEVEL_NAMES[level], matchedVerb: verb };
      }
    }
  }

  for (const level of [1, 2, 3, 4, 5, 6]) {
    for (const verb of BLOOM_VERBS[level]) {
      if (new RegExp(`\\b${verb}\\b`).test(textLower)) {
        return { level, levelName: LEVEL_NAMES[level], matchedVerb: verb };
      }
    }
  }

  return { level: 2, levelName: "Understand", matchedVerb: "unknown" };
}

const STUDY_GUIDANCE = {
  pre_lecture: {
    1: "Skim and define the term. Just know it exists.",
    2: "Read the section. Try to explain it out loud after.",
    3: "Read and note the steps. Full mastery comes after lecture.",
    4: "Build a rough comparison table. Lecture will sharpen it.",
    5: "Read for exposure only. Flag this — revisit post-lecture.",
    6: "Read for exposure only. Flag this — revisit post-lecture.",
  },
  post_lecture: {
    1: "Can you write the definition from memory?",
    2: "Explain it in plain language without notes.",
    3: "Work a practice problem or clinical scenario.",
    4: "Complete your comparison table. Can you distinguish without prompts?",
    5: "Justify the answer. Why is one option better than another?",
    6: "Can you construct or design the thing from scratch?",
  },
  DLA: {
    1: "Master this independently — no lecture is coming.",
    2: "Write a full explanation in your own words before moving on.",
    3: "Apply it to a practice problem before moving on.",
    4: "Build the full comparison. Do not move on until you can differentiate.",
    5: "Work through a clinical vignette and defend your reasoning.",
    6: "Construct or formulate the full answer independently.",
  },
  SG: {
    1: "Should be automatic by now.",
    2: "Be ready to explain to a peer.",
    3: "Be ready to apply in a group case.",
    4: "Be ready to defend your comparison to the group.",
    5: "Bring your reasoning — group will challenge it.",
    6: "Be ready to walk through your constructed answer.",
  },
};

export function getStudyGuidance(activityType, bloomLevel) {
  return STUDY_GUIDANCE[activityType]?.[bloomLevel] || "Review this objective.";
}

export function getActivityType(lectureType) {
  const t = (lectureType || "").toUpperCase();
  if (t === "DLA") return "DLA";
  if (t === "SG" || t === "TBL") return "SG";
  return "lecture";
}

export function enrichObjectiveWithBloom(obj, lectureType) {
  const bloom = getBloomLevel(obj.objective || "");
  const activityType = getActivityType(lectureType);
  return {
    ...obj,
    bloom_level: bloom.level,
    bloom_level_name: bloom.levelName,
    bloom_verb: bloom.matchedVerb,
    pre_lecture_guide: getStudyGuidance("pre_lecture", bloom.level),
    post_lecture_guide:
      getStudyGuidance(
        activityType === "DLA" ? "DLA" : activityType === "SG" ? "SG" : "post_lecture",
        bloom.level
      ),
    dla_guide: getStudyGuidance("DLA", bloom.level),
    sg_guide: getStudyGuidance("SG", bloom.level),
  };
}

export { LEVEL_NAMES, LEVEL_COLORS, LEVEL_BG };
