/**
 * SP1 T6.1 — creating a lecture from a text file, in the shell.
 *
 * App's upload pipeline is 1,154 lines covering PDF.js, Mistral OCR, an AI
 * extraction queue and cloud push. This is not that: it is the markdown path,
 * which is the one that actually gets used (pdf2md locally, then drop the .md
 * in). PDF and OCR stay in App until they can be ported with the same care.
 *
 * Pure — the caller owns the store writes.
 */

/** "MSK Lecture 27 - Histology of the Skin.md" → type LEC, number 27, title. */
export function parseLectureFilename(filename) {
  const base = String(filename || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim();

  const typeMatch = base.match(/\b(DLA|CLIN|LEC|SG|LAB|US|IMCQ)\b/i);
  const type = typeMatch ? typeMatch[1].toUpperCase() : "LEC";

  // The number that follows the type word, else the first standalone number.
  const afterType = typeMatch ? base.slice(base.indexOf(typeMatch[0]) + typeMatch[0].length) : base;
  const numMatch =
    afterType.match(/\s*0*(\d{1,3})\b/) ||
    base.match(/\b(?:lecture|lec)\s*0*(\d{1,3})\b/i) ||
    base.match(/\b0*(\d{1,3})\b/);
  const number = numMatch ? parseInt(numMatch[1], 10) : null;

  // Title = whatever follows the first " - " / " — ", else the whole name.
  const dash = base.match(/\s[-—–]\s(.+)$/);
  const title = (dash ? dash[1] : base).trim();

  return { type, number, title: title || base };
}

/** One chunk per markdown heading block, so long lectures stay navigable. */
export function chunkMarkdown(text, { maxChars = 4000 } = {}) {
  const body = String(text || "").trim();
  if (!body) return [];

  const sections = body.split(/\n(?=#{1,3}\s)/g).filter((s) => s.trim());
  const chunks = [];
  for (const section of sections.length ? sections : [body]) {
    if (section.length <= maxChars) {
      chunks.push({ markdown: section.trim() });
      continue;
    }
    // Oversized section: split on blank lines rather than mid-sentence.
    let buffer = "";
    for (const para of section.split(/\n\s*\n/)) {
      if ((buffer + para).length > maxChars && buffer) {
        chunks.push({ markdown: buffer.trim() });
        buffer = "";
      }
      buffer += (buffer ? "\n\n" : "") + para;
    }
    if (buffer.trim()) chunks.push({ markdown: buffer.trim() });
  }
  return chunks;
}

/**
 * Build the lecture record. Matches what App's uploader writes, so both shells
 * and the sync path read it identically.
 */
export function buildLectureRecord({ filename, text, blockId, termId = null, lectureDate = null, idgen }) {
  if (!blockId) return { error: "Pick a block first." };
  const body = String(text || "").trim();
  if (body.length < 50) return { error: "That file has almost no text in it." };

  const { type, number, title } = parseLectureFilename(filename);
  const newId =
    idgen?.() ??
    (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lec_${Date.now()}`);

  return {
    lecture: {
      id: newId,
      blockId,
      termId,
      lectureType: type,
      lectureNumber: number,
      lectureTitle: title,
      filename,
      lectureDate,
      chunks: chunkMarkdown(body),
      extractionMethod: "markdown-upload",
      uploadedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Replace a same-slot lecture rather than adding a duplicate — the rule the
 * dedupe work landed on: same block, same type, same number, same title.
 * Returns the next list plus what happened, and the id it superseded so the
 * caller can tombstone it (or the cloud copy walks back in on the next pull).
 */
export function upsertLecture(lectures, lecture) {
  const list = lectures || [];
  const sameSlot = (l) =>
    l.blockId === lecture.blockId &&
    (l.lectureType || "LEC") === lecture.lectureType &&
    String(l.lectureNumber ?? "") === String(lecture.lectureNumber ?? "") &&
    String(l.lectureTitle || l.filename || "").trim().toLowerCase() ===
      String(lecture.lectureTitle || lecture.filename || "").trim().toLowerCase();

  const existing = list.find(sameSlot);
  return {
    lectures: [...list.filter((l) => !sameSlot(l)), lecture],
    replacedId: existing?.id ?? null,
    action: existing ? "replaced" : "added",
  };
}
