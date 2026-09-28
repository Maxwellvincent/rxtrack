const STOP = new Set("a an and are as at be because by for from has have in is it of on or patient that the this to was were which with".split(" "));

function tokens(text) {
  const canonical = String(text || "")
    .toLowerCase()
    .replace(/elevated (?:serum )?calcium/g, "hypercalcemia")
    .replace(/parathyroid hormone/g, "pth")
    .replace(/blood pressure/g, "bp")
    .replace(/year[ -]old/g, "age");
  return new Set(canonical.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

function overlap(a, b) {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const word of aa) if (bb.has(word)) intersection++;
  return intersection / new Set([...aa, ...bb]).size;
}

export function questionFingerprint(question) {
  return [...tokens(`${question?.topic || ""} ${question?.stem || ""}`)].sort().join("|");
}

export function isSemanticDuplicate(question, existing = [], threshold = 0.6) {
  return (existing || []).some((other) => overlap(question?.stem, other?.stem) >= threshold);
}

function features(question) {
  const stem = String(question?.stem || "");
  const ending = stem.split(/(?<=[.!?])\s+/).at(-1) || stem;
  return {
    words: stem.trim().split(/\s+/).filter(Boolean).length,
    sentences: stem.split(/[.!?]+/).filter(Boolean).length,
    options: Object.keys(question?.choices || {}).length,
    clinical: /\b(year-old|patient|presents|comes to|history of|physical examination)\b/i.test(stem),
    data: /\b(laboratory|serum|blood pressure|mm hg|imaging|biopsy|photomicrograph|ultrasound|mri|x-ray)\b/i.test(stem),
    ending: /\b(mechanism|explain|cause|why)\b/i.test(ending) ? "mechanism"
      : /\b(expected|finding|change|concentration|level|result)\b/i.test(ending) ? "prediction"
        : /\b(diagnosis|disorder|condition)\b/i.test(ending) ? "diagnosis"
          : /\b(enzyme|structure|nerve|vessel|hormone|pathway|receptor)\b/i.test(ending) ? "identification" : "other",
  };
}

/** Aggregate structural fit to the whole verified bank, not a best-match single exemplar. */
export function schoolStyleSimilarity(question, exemplars = []) {
  const refs = (exemplars || []).filter((q) => q?.stem && Object.keys(q?.choices || {}).length >= 2);
  if (!refs.length) return null;
  const target = features(question);
  const samples = refs.map(features);
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  };
  const wordTarget = median(samples.map((s) => s.words));
  const sentenceTarget = median(samples.map((s) => s.sentences));
  const optionRate = samples.filter((s) => s.options === target.options).length / samples.length;
  const binaryRate = (key) => {
    const rate = samples.filter((s) => s[key]).length / samples.length;
    return 1 - Math.abs(Number(target[key]) - rate);
  };
  const endingRate = samples.filter((s) => s.ending === target.ending).length / samples.length;
  const closeness = (actual, expected) => 1 - Math.min(1, Math.abs(actual - expected) / Math.max(expected, 8));
  const score = closeness(target.words, wordTarget) * 0.28
    + closeness(target.sentences, sentenceTarget) * 0.17
    + optionRate * 0.25
    + binaryRate("clinical") * 0.12
    + binaryRate("data") * 0.08
    + endingRate * 0.10;
  // It's a transparent heuristic, never a certification of equivalence.
  const sampleConfidence = 0.55 + 0.45 * Math.min(1, samples.length / 12);
  return Math.min(95, Math.round(score * sampleConfidence * 100));
}

const normalize = value => {
  const text = value && typeof value === "object" ? Object.entries(value).map(([key, cell]) => `${key} ${cell ?? ""}`).join(" ") : String(value || "");
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
};

/** Free deterministic review passes before a generated item can enter Firestore. */
export function questionQualityIssues(question, objectives = []) {
  const issues = [];
  const choices = Object.values(question?.choices || {}).map(normalize).filter(Boolean);
  if (new Set(choices).size !== choices.length) issues.push("duplicate answer choices");

  const stem = String(question?.stem || "");
  if (/\b(?:explicitly identified|stated|listed|mentioned)\s+(?:in|by)\s+(?:the\s+)?(?:supplied\s+)?(?:lecture\s+)?(?:learning\s+)?objective\b|\baccording to the (?:lecture|learning) objective\b/i.test(stem)) {
    issues.push("asks about objective wording instead of testing the medical concept");
  }
  const sentences = stem.split(/(?<=[.!?])\s+/).map(normalize).filter(s => s.split(" ").length >= 6);
  if (new Set(sentences).size !== sentences.length) issues.push("repeated sentence in stem");

  const correctText = normalize(question?.choices?.[question?.correct]);
  if (correctText.split(" ").length >= 3 && normalize(stem).includes(correctText)) issues.push("answer revealed in stem");

  // Objective fidelity and explanation depth are prompted and surfaced, but
  // lexical overlap is not a safe rejection rule because valid mechanisms
  // often use synonyms absent from the short objective sentence.
  void objectives;
  return issues;
}
