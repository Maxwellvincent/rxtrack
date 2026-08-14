/**
 * Drill MCQ: match lecture content to an objective for "verify in lecture" snippets.
 */

export function objectiveTextKeywords(currentObj) {
  return (currentObj?.text || currentObj?.objective || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4);
}

/**
 * Prefer chunk match; else best keyword hit in full lecture text (via getLecTextFn).
 * @returns {null | { source: "chunk", markdown?: string, text?: string } | { source: "fullText", text: string }}
 */
export function findRelevantLectureExcerpt(lec, currentObj, getLecTextFn) {
  const keywords = objectiveTextKeywords(currentObj);
  if (!keywords.length) return null;

  if (lec?.chunks?.length) {
    const hit = lec.chunks.find((c) => {
      const text = (c.markdown || c.text || "").toLowerCase();
      return keywords.some((kw) => kw && text.includes(kw));
    });
    if (hit) {
      return { source: "chunk", markdown: hit.markdown, text: hit.text };
    }
  }

  if (typeof getLecTextFn !== "function") return null;
  const full = String(getLecTextFn(lec) || "").replace(/\s+/g, " ");
  const lower = full.toLowerCase();
  let bestStart = -1;
  let bestLen = 0;
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    if (kw.length > bestLen) {
      bestLen = kw.length;
      bestStart = idx;
    }
  }
  if (bestStart < 0) return null;

  const radius = 140;
  const start = Math.max(0, bestStart - radius);
  const end = Math.min(full.length, bestStart + bestLen + radius);
  const slice = full.slice(start, end).trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = end < full.length ? "…" : "";
  return { source: "fullText", text: prefix + slice + suffix };
}

export function excerptPlainText(ex) {
  if (!ex) return "";
  if (ex.source === "chunk") return String(ex.markdown ?? ex.text ?? "").trim();
  return String(ex.text ?? "").trim();
}
