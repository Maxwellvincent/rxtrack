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
  return {
    words: stem.trim().split(/\s+/).filter(Boolean).length,
    options: Object.keys(question?.choices || {}).length,
    clinical: /\b(year-old|patient|presents|comes to|history of|physical examination)\b/i.test(stem),
    data: /\b(laboratory|serum|blood pressure|mm hg|imaging|biopsy|photomicrograph|ultrasound|mri|x-ray)\b/i.test(stem),
  };
}

/** Structural similarity only: style/format, never factual correctness. */
export function schoolStyleSimilarity(question, exemplars = []) {
  const refs = (exemplars || []).filter((q) => q?.stem && Object.keys(q?.choices || {}).length >= 2);
  if (!refs.length) return null;
  const target = features(question);
  const scores = refs.map((ref) => {
    const sample = features(ref);
    const wordScore = 1 - Math.min(1, Math.abs(target.words - sample.words) / Math.max(sample.words, 20));
    const optionScore = Math.max(0, 1 - Math.abs(target.options - sample.options) / 3);
    const clinicalScore = target.clinical === sample.clinical ? 1 : 0;
    const dataScore = target.data === sample.data ? 1 : 0;
    return wordScore * 0.35 + optionScore * 0.3 + clinicalScore * 0.2 + dataScore * 0.15;
  });
  return Math.round(Math.max(...scores) * 100);
}
