/**
 * SP1 T6.1 — creating a lecture from a file, in the shell.
 *
 * Two paths, one record shape: markdown (pdf2md locally, drop the .md in) and
 * PDF, which goes through the extraction layer in src/ingest/pdfText.js first.
 * Objectives and the teaching map are separate steps the caller runs after the
 * record is saved; App still owns the batch upload queue.
 *
 * Pure — the caller owns the store writes and the extraction call.
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

/** Body text of a chunk, whichever shape the extractor produced. */
function chunkBody(chunk) {
  if (typeof chunk === "string") return chunk;
  return chunk?.markdown || chunk?.text || "";
}

/**
 * Build the lecture record from a PDF extraction (src/ingest/pdfText.js).
 *
 * The filename stays the authority on type/number/title — it is how Louis names
 * lectures and it is what the .md path uses — with the extractor's own title
 * only filling in when the filename has nothing but the type and number in it.
 */
export function buildLectureFromExtraction({
  filename,
  contentResult,
  method = null,
  blockId,
  termId = null,
  lectureDate = null,
  idgen,
}) {
  if (!blockId) return { error: "Pick a block first." };

  const chunks = contentResult?.chunks?.length
    ? contentResult.chunks
    : contentResult?.sections || [];
  const fullText = String(
    contentResult?.fullText || chunks.map(chunkBody).join("\n\n") || ""
  ).trim();

  if (!fullText || fullText.length < 50) {
    return {
      error:
        method === "none" || !fullText
          ? "No text came out of that PDF — it is probably scanned images. Convert it with pdf2md and upload the .md."
          : "That PDF gave almost no text.",
    };
  }

  const { type, number, title } = parseLectureFilename(filename);
  const base = String(filename || "").replace(/\.[a-z0-9]+$/i, "").trim();
  // A filename like "ER LEC 02" carries no title of its own; take the extractor's.
  const titleIsBareSlot = title === base;
  const lectureTitle =
    (titleIsBareSlot && String(contentResult?.lectureTitle || "").trim()) || title;

  const newId =
    idgen?.() ??
    (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lec_${Date.now()}`);
  const now = new Date().toISOString();

  return {
    lecture: {
      id: newId,
      blockId,
      termId,
      lectureType: type,
      lectureNumber: number ?? contentResult?.lectureNumber ?? null,
      lectureTitle,
      filename,
      lectureDate,
      chunks,
      fullText,
      subject: contentResult?.subject || contentResult?.discipline || "",
      keyTerms: contentResult?.keyTerms || [],
      summary: contentResult?.summary || "",
      slideImages: contentResult?.slideImages || [],
      pageCount: contentResult?.pageCount ?? chunks.length,
      extractionMethod: contentResult?.extractionMethod || method || "pdf-upload",
      uploadedAt: now,
      createdAt: now,
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
