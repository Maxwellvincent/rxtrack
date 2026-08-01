/** Single chunk: prefer markdown (Mistral OCR), else plain text / legacy content. */
export function getChunkBody(c) {
  if (!c) return "";
  return String(c.markdown || c.text || c.content || "");
}

/**
 * Lecture body for AI: joined chunk markdown/text; else legacy fields + fullText;
 * plus supplemental resources (YouTube transcripts, image descriptions).
 */
export function getLecText(lec) {
  if (!lec) return "";
  let chunks = "";
  if (lec.chunks && lec.chunks.length > 0) {
    chunks = lec.chunks
      .map((c) => (c && (c.markdown || c.text)) || "")
      .join("\n\n");
  } else {
    chunks = lec.extractedText || lec.content || lec.fullText || "";
  }
  const supplemental = (lec.supplemental || [])
    .map((s) => {
      if (!s) return "";
      if (s.type === "youtube") {
        const title = s.title || "Video";
        return `\n\n## VIDEO TRANSCRIPT: ${title}\n${s.transcript || ""}`;
      }
      if (s.type === "image") {
        return `\n\n## IMAGE CONTENT: ${s.filename || "image"}\n${s.aiDescription || ""}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  let blockExtra = "";
  if (typeof window !== "undefined" && lec.blockId) {
    try {
      const stored = JSON.parse(localStorage.getItem("rxt-supplemental-resources") || "[]");
      const forBlock = (stored || []).filter((r) => r && r.blockId === lec.blockId);
      blockExtra = forBlock
        .map((r) => {
          if (r.type === "youtube") {
            const title = r.title || "Video";
            return `\n\n## VIDEO: ${title}\n${(r.transcript || "").slice(0, 3000)}`;
          }
          if (r.type === "image") {
            return `\n\n## IMAGE: ${r.filename || "image"}\n${r.aiDescription || ""}`;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n\n");
    } catch {
      /* ignore */
    }
  }

  return chunks + supplemental + blockExtra;
}

/**
 * How much lecture text one teaching section may send to the model.
 *
 * The old cap was 2000 characters, which is ~500 tokens — on a 23k-character lecture split into
 * three sections that discarded roughly three quarters of every section, mid-sentence. The model
 * then had a fragment with no start and no end, so it produced loose definitions instead of
 * walking the objective. Sections are a few thousand characters; there is no reason to cut them.
 */
export const SECTION_CHAR_CAP = 12000;

/**
 * Trim to at most `max` characters without cutting mid-sentence.
 *
 * Prefers a paragraph break, then a sentence end, then a space, and only falls back to a hard
 * cut when the text has no break at all. Never returns more than `max`.
 */
export function sliceAtBoundary(text, max = SECTION_CHAR_CAP) {
  const s = String(text || "");
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  // Only accept a boundary in the last third, otherwise a single early break throws away
  // most of the window we were trying to keep.
  const floor = Math.floor(max * 0.66);
  for (const re of [/\n\s*\n(?![\s\S]*\n\s*\n)/, /[.!?]\s(?![\s\S]*[.!?]\s)/, /\s(?!\S*\s)/]) {
    const m = head.match(re);
    if (m && m.index >= floor) return head.slice(0, m.index + (re.source.startsWith("[.!?]") ? 1 : 0)).trim();
  }
  return head.trim();
}

/**
 * Split a lecture into `count` ordered windows, each boundary-trimmed.
 * Used when a lecture has no parsed objectives, so sections come from the text itself.
 */
export function splitLectureIntoSections(text, count) {
  const s = String(text || "");
  const n = Math.max(1, count | 0);
  if (!s) return Array(n).fill("");
  const size = Math.ceil(s.length / n);
  return Array.from({ length: n }, (_, i) => sliceAtBoundary(s.slice(i * size, (i + 1) * size)));
}
