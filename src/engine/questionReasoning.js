export const MISS_TYPE_LABELS = {
  comprehension: "Question language",
  depth: "Reasoning depth",
  content: "Content gap",
  careless: "Execution / fatigue",
};

export const REASONING_DEPTHS = [
  "state-recognition",
  "pathway-process",
  "mechanism",
  "enzyme-structure",
  "regulation-cofactor",
  "clinical-consequence",
];

export function buildReasoningDepthPlan(count = 5) {
  const requested = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
  const progression = ["state-recognition", "pathway-process", "mechanism", "enzyme-structure", "regulation-cofactor", "clinical-consequence"];
  return Array.from({ length: requested }, (_, index) => progression[index % progression.length]);
}

const MISS_TYPES = new Set(Object.keys(MISS_TYPE_LABELS));

export function normalizeMissDiagnostic(raw = {}) {
  const primaryType = MISS_TYPES.has(raw.primaryType) ? raw.primaryType : null;
  const secondaryType = MISS_TYPES.has(raw.secondaryType) && raw.secondaryType !== primaryType ? raw.secondaryType : null;
  const depth = REASONING_DEPTHS.includes(raw.depth) ? raw.depth : null;
  const lines = (value, max = 2) => (Array.isArray(value) ? value : [value])
    .map((item) => String(item || "").trim()).filter(Boolean).slice(0, max);
  return {
    patient: String(raw.patient || "").trim().slice(0, 240),
    asksFor: String(raw.asksFor || "").trim().slice(0, 180),
    preserved: lines(raw.preserved),
    breakPoint: String(raw.breakPoint || "").trim().slice(0, 240),
    depth,
    bridge: String(raw.bridge || "").trim().slice(0, 420),
    primaryType,
    secondaryType,
    choiceTrap: String(raw.choiceTrap || "").trim().slice(0, 260),
    anki: {
      kind: ["comprehension", "depth", "content", "none"].includes(raw.anki?.kind) ? raw.anki.kind : "none",
      front: String(raw.anki?.front || "").trim().slice(0, 220),
      back: String(raw.anki?.back || "").trim().slice(0, 320),
    },
  };
}

export function buildMissDiagnosisPrompt({ question, selectedChoice, patientInterpretation, requestedTarget, learnerPrediction }) {
  const choices = Object.entries(question?.choices || {}).map(([letter, choice]) => `${letter}. ${typeof choice === "string" ? choice : JSON.stringify(choice)}`).join("\n");
  return `Diagnose the learner's reasoning on this missed medical-school question. Be concise, preserve every correct step, and identify the FIRST point where reasoning diverged. Do not label every miss as a content gap.\n\n` +
    `QUESTION (the source key is the supplied answer key, not independent medical verification):\n${question?.stem || ""}\nChoices:\n${choices}\nLearner chose: ${selectedChoice || "not recorded"}\nKeyed choice: ${question?.correct || "unknown"} — ${question?.choices?.[question?.correct] || "unknown"}\nSource rationale: ${question?.explanation || "not supplied"}\nObjective/fact context: ${question?.objectiveFacet || question?.topic || "not supplied"}\n\n` +
    `Learner's patient model: ${patientInterpretation || "not supplied"}\nWhat learner thinks the ask wants: ${requestedTarget || "not supplied"}\nLearner's pre-choice prediction: ${learnerPrediction || "not supplied"}\n\n` +
    `Classify primaryType as comprehension (question language/target), depth (correct concept but stopped too early), content (did not know the needed relationship), or careless (execution/time/fatigue; use only when learner evidence supports it). secondaryType may be another of these or null. depth must be one of ${REASONING_DEPTHS.join(", ")} or null. Return JSON only with fields: patient (plain-language story), asksFor (precise target type), preserved (0-2 correct steps), breakPoint (first broken link), depth, bridge (short causal chain), primaryType, secondaryType, choiceTrap (why selected choice was tempting and what would make it correct), anki {kind: comprehension|depth|content|none, front, back}. Do not create an Anki card for a step the learner already demonstrated. Keep each field short. Never invent facts absent from supplied context; if the key/rationale looks inconsistent, say so in bridge and set primaryType to null. Answer may be revealed after this diagnostic.\n`;
}

export async function diagnoseQuestionMiss(input = {}, deps = {}) {
  if (typeof deps.callAIJSON !== "function") return { error: "The configured AI provider is unavailable for miss diagnosis." };
  if (!String(input.patientInterpretation || "").trim() || !String(input.requestedTarget || "").trim()) {
    return { error: "Add your patient model and what the question is asking before diagnosing the miss." };
  }
  try {
    const result = await deps.callAIJSON(
      "You are a precise Step 1 reasoning coach. Preserve correct reasoning, diagnose the first broken link, and never assume an incorrect answer proves the learner lacks the whole topic.",
      buildMissDiagnosisPrompt(input),
      {},
      1500,
      undefined,
      undefined,
      { throwOnError: true }
    );
    const diagnostic = normalizeMissDiagnostic(result || {});
    if (!diagnostic.patient || !diagnostic.asksFor || !diagnostic.bridge || !diagnostic.primaryType) {
      return { error: "The configured provider returned an incomplete reasoning diagnosis. Try again or classify the miss yourself." };
    }
    return { diagnostic };
  } catch (error) {
    return { error: error?.message || "Could not diagnose this miss with the configured provider." };
  }
}

export function reasoningGuidance(profile = {}, count = 10) {
  const entries = Object.entries(profile || {}).filter(([type, stat]) => MISS_TYPES.has(type) && Number(stat?.count ?? stat) > 0)
    .map(([type, stat]) => [type, Number(stat?.count ?? stat)])
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const top = entries[0];
  const chunk = Math.min(5, Math.max(1, Number(count) || 1));
  if (!top || total < 5) return `Build a progressive set in short ${chunk}-question reasoning chunks: begin with state/process recognition, then move to one-step-deeper mechanisms and consequences when source facts support it. Vary question tasks; do not make difficulty depend on vagueness.`;
  const pct = Math.round(top[1] / total * 100);
  const directives = {
    comprehension: "Use clear, precise lead-ins and deliberately vary target-language (origin vs synapse, mechanism vs consequence, increased vs decreased) so wording is practiced without obscuring the medicine.",
    depth: "Use one-level-deeper items: make the learner's likely pathway/state recognition explicit or obvious, then ask for the next causal link. Preserve the correct intermediate concept rather than asking for it again.",
    content: "Prioritize the specific missing objective relationship, scaffold from recognition to mechanism, and then transfer it to a new patient presentation.",
    careless: "Keep batches to five, avoid decorative detail, vary only the discriminating clue, and include brief consolidation checkpoints; do not raise depth merely because of an isolated miss.",
  };
  return `Learner-confirmed miss profile from ${total} classified misses: ${top[0]} (${pct}%). ${directives[top[0]]} Generate ${chunk}-question cognitive-load chunks, then vary depth progressively; keep all facts within the lecture/objectives.`;
}
