/**
 * SP1 T2.1 — the per-lecture study flow: lecture → atoms → calibrated quiz.
 *
 * The pieces already existed but only as a throwaway upload modal. Here they run
 * against a REAL lecture from the store, and the atoms persist on the lecture in
 * Firestore so the extraction is done once, not once per session.
 *
 * Everything effectful takes injected deps (`fetchContent`, `saveAtoms`,
 * `callAIJSON`), so the whole sequence is testable without a network.
 */
import { extractTypedHighYield } from "../../../engine/extractHighYield.js";
import { generateFromAtoms } from "../../../engine/mcq.js";
import { getChunkBody } from "../../../lectureText.js";

/** Minimum characters worth sending to the extractor. */
export const MIN_TEXT = 200;

/** Lecture body from whatever the source has: chunks first, then flat fields. */
export function lectureTextFrom(source) {
  if (!source) return "";
  const chunks = (source.chunks || []).map(getChunkBody).filter(Boolean).join("\n\n");
  if (chunks.trim()) return chunks;
  const meta = source.meta || source;
  return String(meta.extractedText || meta.content || meta.fullText || "");
}

/**
 * What the UI should offer for this lecture.
 *
 * - `quiz`    — atoms already extracted, go straight to questions
 * - `extract` — text is available, offer extraction
 * - `upload`  — no stored text (the common case for older terms), ask for the .md
 */
export function flowStage({ atoms, text }) {
  if (atoms?.length) return "quiz";
  if (String(text || "").trim().length >= MIN_TEXT) return "extract";
  return "upload";
}

/** Fetch a lecture's stored content, tolerating a cloud that has nothing for it. */
export async function loadLecture(lecture, { fetchContent, userId }) {
  const local = lectureTextFrom(lecture);
  let atoms = Array.isArray(lecture?.atoms) ? lecture.atoms : [];
  let text = local;

  if ((!atoms.length || !text) && fetchContent) {
    try {
      const remote = await fetchContent(userId, lecture?.id);
      if (remote) {
        if (!atoms.length) atoms = remote.atoms || [];
        if (!text) text = lectureTextFrom(remote);
      }
    } catch (e) {
      return { atoms, text, stage: flowStage({ atoms, text }), error: e?.message || String(e) };
    }
  }

  return { atoms, text, stage: flowStage({ atoms, text }), error: null };
}

/**
 * Extract atoms from lecture text and persist them on the lecture.
 * A save failure does not lose the atoms — they come back either way.
 */
export async function extractAtoms(lecture, text, deps = {}) {
  const { callAIJSON, saveAtoms, userId } = deps;
  const result = await extractTypedHighYield(
    text,
    { lectureTitle: lecture?.lectureTitle || lecture?.title, lectureType: lecture?.lectureType },
    { callAIJSON }
  );
  if (result.error) return { atoms: result.atoms || [], error: result.error, saved: false };

  const atoms = result.atoms || [];
  if (!atoms.length) return { atoms, error: "No atoms found in that lecture.", saved: false };

  let saved = false;
  if (saveAtoms && lecture?.id) {
    try {
      await saveAtoms(userId, lecture.id, atoms);
      saved = true;
    } catch (e) {
      return { atoms, error: null, saved: false, saveError: e?.message || String(e) };
    }
  }
  return { atoms, error: null, saved };
}

/** One Step-1 question per atom, in the school's style when exemplars exist. */
export async function quizFromAtoms(lecture, atoms, deps = {}) {
  const { callAIJSON, exemplars = [], difficulty = "medium" } = deps;
  return generateFromAtoms(
    {
      atoms,
      subject: lecture?.lectureTitle || lecture?.title || "this lecture",
      difficulty,
      examples: exemplars,
    },
    { callAIJSON }
  );
}

/**
 * How many atoms one study round covers.
 *
 * The screen used to render every atom at once — sixty rows of "term — content" for a full
 * lecture, with nothing on it that could be finished. A round has to be small enough to start
 * when you don't feel like starting, and it has to end.
 */
export const ROUND_SIZE = 5;

/**
 * Split atoms into ordered rounds. Atoms arrive already sorted by the canonical type sequence
 * (definitions, mechanisms, relationships, results), so slicing preserves that order.
 */
export function atomRounds(atoms, size = ROUND_SIZE) {
  const list = Array.isArray(atoms) ? atoms.filter(Boolean) : [];
  const n = Math.max(1, size | 0);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Human label for where you are: "atoms 6–10 of 48". */
export function roundLabel(index, rounds, total, size = ROUND_SIZE) {
  if (!rounds.length) return "";
  const start = index * size + 1;
  const end = start + (rounds[index]?.length || 0) - 1;
  return `atoms ${start}–${end} of ${total}`;
}
