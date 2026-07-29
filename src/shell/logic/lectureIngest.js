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
 * Fields that belong to the schedule, not to the file being uploaded.
 *
 * A block's lectures arrive from the schedule import first: the right titles,
 * dates and week numbers, with no content. Uploading the deck fills that row
 * in. Replacing it instead — new id, tombstone the old — throws the schedule
 * away, and Today plans backwards from those dates.
 */
const SCHEDULE_FIELDS = ["lectureDate", "weekNumber", "dayOfWeek", "examDate", "studyMode"];

/**
 * Merge an upload into the lecture that is already there.
 *
 * Keeps the existing id, so nothing that points at this lecture — objectives,
 * performance, completion, atoms — is orphaned. Keeps the schedule fields
 * unless the upload explicitly carries one. Everything about the content comes
 * from the upload.
 */
export function fillLecture(existing, incoming) {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "id") continue; // the row keeps its identity
    if (SCHEDULE_FIELDS.includes(key)) {
      // Only overwrite a schedule field when the upload actually has one.
      if (value != null && value !== "") merged[key] = value;
      continue;
    }
    if (value !== undefined) merged[key] = value;
  }

  // A schedule row's title is the curriculum's; keep it unless it was empty.
  if (existing.lectureTitle) merged.lectureTitle = existing.lectureTitle;
  merged.id = existing.id;
  merged.contentUpdatedAt = new Date().toISOString();
  return merged;
}

/**
 * Replace a same-slot lecture rather than adding a duplicate — the rule the
 * dedupe work landed on: same block, same type, same number, same title.
 * Returns the next list plus what happened, and the id it superseded so the
 * caller can tombstone it (or the cloud copy walks back in on the next pull).
 */
function sameNumberSlot(l, lecture) {
  return (
    l.blockId === lecture.blockId &&
    (l.lectureType || "LEC") === lecture.lectureType &&
    String(l.lectureNumber ?? "") === String(lecture.lectureNumber ?? "")
  );
}

/**
 * Titles are compared with the slot prefix stripped.
 *
 * The same lecture is stored both ways in real data: an older upload kept the
 * whole filename ("Lecture 01 - Endocrine System") while parseLectureFilename
 * takes the part after the dash ("Endocrine System"). Comparing raw strings
 * calls those two different lectures and duplicates the row.
 */
function normalizeTitle(value) {
  return String(value || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^\s*(?:lecture|lec|dla|clin|sg|lab|us|imcq)\s*0*\d*\s*[-–—:]?\s*/i, "")
    .trim()
    .toLowerCase();
}

function sameTitle(l, lecture) {
  const a = normalizeTitle(l.lectureTitle || l.filename);
  const b = normalizeTitle(lecture.lectureTitle || lecture.filename);
  return !!a && a === b;
}

/** A schedule row: the slot exists, with dates, but no content has landed yet. */
function isEmptyStub(l) {
  return !(l.chunks || []).length && !String(l.fullText || "").trim();
}

/**
 * Which existing lecture this upload belongs to.
 *
 * Exact slot first. Failing that, an empty stub with the same type and number —
 * schedule import creates those with a filename like "ER LEC 02" and no title
 * at all, so a title comparison never matches one and the upload lands as a
 * second LEC 2 next to the dated row it was meant to fill.
 *
 * A row that already has content and a different title is left alone: two real
 * lectures can share a number.
 */
export function findFillTarget(lectures, lecture) {
  const list = lectures || [];
  return (
    list.find((l) => sameNumberSlot(l, lecture) && sameTitle(l, lecture)) ||
    list.find((l) => sameNumberSlot(l, lecture) && isEmptyStub(l)) ||
    null
  );
}

/**
 * Land an upload in the list.
 *
 * Default is to fill the row that is already there — keeping its id, and with
 * it every objective, session and completion record that points at it, plus the
 * schedule's dates. `mode: "replace"` keeps the old behaviour of swapping in a
 * brand new row, which the caller must then tombstone.
 */
export function upsertLecture(lectures, lecture, { mode = "fill" } = {}) {
  const list = lectures || [];
  const existing = findFillTarget(list, lecture);

  if (!existing) {
    return { lectures: [...list, lecture], replacedId: null, filledId: null, action: "added" };
  }

  if (mode === "replace") {
    return {
      lectures: [...list.filter((l) => l.id !== existing.id), lecture],
      replacedId: existing.id,
      filledId: null,
      action: "replaced",
    };
  }

  const merged = fillLecture(existing, lecture);
  return {
    lectures: list.map((l) => (l.id === existing.id ? merged : l)),
    replacedId: null,
    filledId: existing.id,
    lecture: merged,
    action: "filled",
  };
}
