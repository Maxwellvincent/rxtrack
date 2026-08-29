/**
 * SP1 — importing a folder of lectures in one pass.
 *
 * A term is 20-40 decks and there are several terms, so the one-at-a-time modal
 * is the wrong shape: this plans the whole batch up front, says what will be
 * added versus replaced before anything is written, and keeps the local row
 * chunk-light so a hundred lectures' text cannot blow the ~5MB localStorage
 * quota — the text goes to Firestore, which is where every non-active term's
 * text already lives.
 *
 * Pure. The caller owns extraction, the store writes and the AI passes.
 */
import { findFillTarget, parseLectureFilename, upsertLecture } from "./lectureIngest.js";
import { cleanLectureTitle } from "../../lectureTitle.js";


/** Path depth, so a file sitting at the top of the chosen folder wins. */
function depthOf(file) {
  const rel = file?.webkitRelativePath || "";
  return rel ? rel.split("/").length : 1;
}

const baseName = (name) => cleanLectureTitle(name).toLowerCase();
const isMarkdown = (name) => /\.(md|markdown|txt)$/i.test(name || "");

/**
 * One file per lecture, out of whatever was selected.
 *
 * Picking the folder hands over everything in it, and after a conversion run
 * that means three copies of each lecture: the source PDF, the markdown beside
 * it, and marker's per-document subfolder holding the same markdown again.
 * Feeding all of them in would re-OCR decks that are already converted, which
 * is minutes each against a fraction of a second for the markdown.
 *
 * So: markdown beats PDF for the same lecture, and the shallowest copy wins.
 */
export function selectBestFiles(files) {
  const best = new Map();

  for (const file of files || []) {
    const name = file?.name || "";
    if (!name || !/\.(pdf|md|markdown|txt)$/i.test(name)) continue;

    const key = baseName(name);
    const current = best.get(key);
    if (!current) {
      best.set(key, file);
      continue;
    }

    const currentIsMd = isMarkdown(current.name);
    const candidateIsMd = isMarkdown(name);
    if (candidateIsMd && !currentIsMd) best.set(key, file);
    else if (candidateIsMd === currentIsMd && depthOf(file) < depthOf(current)) best.set(key, file);
  }

  return [...best.values()];
}

/**
 * What each file would do, without touching anything.
 *
 * Duplicate filenames inside one selection collapse to the first — picking a
 * folder twice should not queue every lecture twice.
 */
export function planBulkImport(files, existingLectures, blockId) {
  const seen = new Set();
  const plan = [];

  for (const file of files || []) {
    const name = file?.name || "";
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);

    const { type, number, title } = parseLectureFilename(name);
    const candidate = { blockId, lectureType: type, lectureNumber: number, lectureTitle: title };
    const existing = findFillTarget(existingLectures || [], candidate);

    plan.push({
      file,
      filename: name,
      lectureType: type,
      lectureNumber: number,
      lectureTitle: title,
      // "fill" is the normal case for a scheduled block: the row exists with
      // its date, and the upload is the content it has been waiting for.
      action: existing ? "fill" : "add",
      fillsId: existing?.id ?? null,
      fillsDate: existing?.lectureDate ?? null,
      status: "queued",
    });
  }

  // Lecture order, so progress reads the way the block does. Un-numbered last.
  return plan.sort((a, b) => {
    if (a.lectureNumber == null) return b.lectureNumber == null ? 0 : 1;
    if (b.lectureNumber == null) return -1;
    return a.lectureNumber - b.lectureNumber;
  });
}

/** Counts for the confirm step, so nothing about the batch is a surprise. */
export function summarizePlan(plan) {
  const add = (plan || []).filter((p) => p.action === "add").length;
  const fill = (plan || []).filter((p) => p.action === "fill").length;
  const dated = (plan || []).filter((p) => p.fillsDate).length;
  return { total: (plan || []).length, add, fill, dated };
}

/**
 * The row that goes to localStorage: everything except the text.
 *
 * `chunks: []` rather than a missing field, because the sync treats an absent
 * chunks field as "we don't hold them, leave the cloud copy alone" — which is
 * exactly what a chunk-light row means.
 */
export function toLocalRow(lecture) {
  const { chunks, fullText, ...rest } = lecture;
  void chunks;
  void fullText;
  return { ...rest, chunks: [] };
}

/** Add or replace in the local list, reusing the one upsert rule. */
export function applyToLectures(lectures, lecture) {
  return upsertLecture(lectures || [], lecture);
}

/**
 * Run the queue with a bounded number in flight.
 *
 * Each lecture costs two model calls, so a hundred of them run for the better
 * part of an hour one at a time; a few at once keeps the wall clock sane
 * without inviting rate limits. Failures are captured per item — one bad deck
 * must not stop the folder.
 */
export async function runQueue(items, worker, { concurrency = 3, onProgress } = {}) {
  const queue = [...(items || [])];
  const results = [];
  let index = 0;

  async function pump() {
    while (queue.length) {
      const item = queue.shift();
      const at = index++;
      try {
        const value = await worker(item, at);
        results.push({ item, ok: true, value });
      } catch (e) {
        results.push({ item, ok: false, error: e?.message || String(e) });
      }
      onProgress?.(results.length, (items || []).length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, pump));
  return results;
}
