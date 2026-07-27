/**
 * SP1 T3.1 — recognition data + prompt, lifted out of the component.
 *
 * PatientRecognition used to read `rxt-block-objectives`, `rxt-weak-concepts`
 * and `rxt-current-block` straight out of localStorage. The container now feeds
 * it from the store hooks, and everything decided along the way lives here so it
 * can be tested without a model or a browser.
 */
import { flattenEntry } from "../../logic/objectives.js";

/** Objectives long enough to hang a clinical case on, as {text, block} anchors. */
export function objectivePoolFrom(objectivesMap, blockId = null) {
  const store = objectivesMap && typeof objectivesMap === "object" ? objectivesMap : {};
  const pool = [];
  for (const [block, entry] of Object.entries(store)) {
    if (blockId && block !== blockId) continue;
    for (const objective of flattenEntry(entry)) {
      const text = objective?.objective || objective?.text || objective?.term || "";
      if (typeof text === "string" && text.trim().length > 8) {
        pool.push({ text: text.trim(), block });
      }
    }
  }
  return pool;
}

/** Concept names from the weak-concept store — the bank weights against these. */
export function weakConceptNames(weakConcepts) {
  const source = weakConcepts && typeof weakConcepts === "object" ? weakConcepts : {};
  const lists = Array.isArray(source) ? [source] : Object.values(source);
  return lists
    .flat()
    .map((c) => c?.concept || c?.subject)
    .filter(Boolean);
}

/**
 * n distinct anchors. `rng` is injectable so a test is not at the mercy of
 * Math.random; the original looped on collisions and could repeat itself.
 */
export function pickAnchors(pool, n = 2, rng = Math.random) {
  const list = Array.isArray(pool) ? pool : [];
  if (!list.length) return [];
  const indexes = new Set();
  const limit = Math.min(n, list.length);
  let guard = 0;
  while (indexes.size < limit && guard < limit * 20) {
    indexes.add(Math.floor(rng() * list.length));
    guard += 1;
  }
  return [...indexes].map((i) => list[i]);
}

export const SYSTEM_PROMPT =
  "You are an expert USMLE Step 1 item-writer and clinical educator. You write " +
  "high-yield patient vignettes that test DISEASE RECOGNITION — the student must " +
  "identify the underlying disease from the clinical picture, not just recall a term. " +
  "You teach in a Socratic, mechanism-first style. Always respond with valid JSON only.";

export function buildUserPrompt(anchors, topicHint) {
  const anchorText = anchors?.length
    ? anchors.map((a, i) => `${i + 1}. ${a.text}`).join("\n")
    : topicHint || "general high-yield preclinical medicine";
  return `Write ONE Step 1-style patient vignette that tests recognition of the disease
underlying these study-guide objective(s):

${anchorText}

Requirements:
- The vignette is a realistic clinical case (age/sex, presentation, relevant history,
  exam findings, and key labs/imaging where appropriate). Do NOT name the disease in the stem.
- The lead-in asks for the MOST LIKELY DIAGNOSIS (recognition), not a fact recall.
- Provide 5 answer options that are plausible diseases/diagnoses (realistic look-alikes),
  exactly one correct.
- For EACH wrong option, give a one-sentence "whyWrong" that contrasts it with the correct
  disease on a distinguishing feature (teach the differential).
- Teach the MECHANISM of the correct disease (pathophysiology that explains the findings),
  in 2-4 sentences, mechanism-first.
- Give one "keyDifferentiator": the single highest-yield feature that nails this diagnosis.

Respond with JSON exactly in this shape:
{
  "vignette": "string (the clinical case, no diagnosis named)",
  "leadIn": "What is the most likely diagnosis?",
  "correctDiagnosis": "string",
  "options": [
    {"letter":"A","text":"disease name","isCorrect":false,"whyWrong":"..."},
    {"letter":"B","text":"disease name","isCorrect":true,"whyWrong":""},
    {"letter":"C","text":"disease name","isCorrect":false,"whyWrong":"..."},
    {"letter":"D","text":"disease name","isCorrect":false,"whyWrong":"..."},
    {"letter":"E","text":"disease name","isCorrect":false,"whyWrong":"..."}
  ],
  "mechanism": "string (pathophysiology that explains the vignette findings)",
  "keyDifferentiator": "string"
}`;
}

/** A generated case is only usable with a stem and options. */
export function isUsableCase(data) {
  return !!(data && data.vignette && Array.isArray(data.options) && data.options.length);
}
