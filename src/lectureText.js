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
