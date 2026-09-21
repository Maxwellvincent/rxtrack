// extractHighYield.js — AI extraction of typed high-yield atoms from a lecture.
// callAIJSON is injected (real one is ../aiClient.js) so the logic is testable
// without a live model. Returns { atoms } or { error }.
import { normalizeHighYield } from "./highYield.js";
import { withDeadline } from "../asyncDeadline.js";

// Lecture extraction must never leave the learner waiting indefinitely. The
// local bridge normally answers well inside this window; if it does not, the UI
// can explain the failure and offer a retry instead of displaying a timer for
// many minutes while cloud fallbacks also exhaust their retries.
export const EXTRACTION_TIMEOUT_MS = 120_000;
export const EXTRACTION_BRIDGE_TIMEOUT_MS = 90_000;

// Preserve the beginning, middle, and end of long slide decks in one request. The old
// first-or-tail strategy silently dropped clinical features placed in the middle of a lecture.
export function buildExtractionWindow(text, segmentSize = 6000) {
  const source = String(text || "");
  if (source.length <= segmentSize * 3) return source;
  const middleStart = Math.max(0, Math.floor((source.length - segmentSize) / 2));
  return [
    "[LECTURE BEGINNING]\n" + source.slice(0, segmentSize),
    "[LECTURE MIDDLE]\n" + source.slice(middleStart, middleStart + segmentSize),
    "[LECTURE END]\n" + source.slice(-segmentSize),
  ].join("\n\n");
}

/** Split long lectures into bounded, overlapping evidence windows. */
export function buildExtractionWindows(text, segmentSize = 6000, maxWindows = 8) {
  const source = String(text || "");
  if (source.length <= segmentSize * 3) return [source];
  const overlap = Math.min(700, Math.floor(segmentSize / 8));
  const windows = [];
  for (let start = 0; start < source.length && windows.length < maxWindows; start += segmentSize - overlap) {
    const end = Math.min(source.length, start + segmentSize);
    let chunk = source.slice(start, end);
    if (end < source.length) {
      const boundary = chunk.lastIndexOf("\n\n");
      if (boundary > segmentSize * 0.65) chunk = chunk.slice(0, boundary);
    }
    windows.push(`[LECTURE SEGMENT ${windows.length + 1}]\n${chunk}`);
    if (end >= source.length) break;
  }
  return windows.length ? windows : [source];
}

const SYSTEM = `You extract HIGH-YIELD, testable atoms from a medical lecture for USMLE Step 1 study.
Every atom is EXACTLY ONE of these four types — nothing else:
- definition   — what a term IS (a concise defining statement)
- mechanism    — how something works: a mechanism of action or step-by-step process
- relationship — how one thing relates to, regulates, or affects another
- result       — the outcome/consequence of a process or state

Rules:
- Prioritize **bolded** terms (markdown ** **) — they are the lecturer's flagged high-yield points.
- Each atom: a specific, testable fact — never a slide title or category header.
- DROP fluff: history, introductions, logistics, motivation, generic background.
- Keep "content" one tight sentence, but do not erase testable qualifiers.
- Preserve small examinable details in separate arrays: testableDetails for distinguishing characteristics, exceptions for "except/only/unlike" rules, and quantitativeDetails for thresholds, ranges, timing, direction arrows, doses, or named values. Preserve laterality, anatomic level, cell type, compartment, and sequence when taught.
- Treat phrases such as "only", "most", "first", "rate-limiting", "except", "in contrast", "after", "before", and "not" as high-risk qualifiers: copy their meaning exactly rather than paraphrasing them away.
- When the lecture supports it, also extract a concrete clinical correlate: the patient pattern, finding, or presentation that makes this fact recognizable on a quiz.
- Add short clinical cues or buzzwords only when the lecture teaches them. For genetics, include the inheritance pattern and the family or pedigree clues that identify it. Do not add Step 1 associations that are absent from the lecture.

Return ONLY valid JSON: { "atoms": [ { "type": "...", "term": "...", "content": "...", "clinicalCorrelate": "...", "clinicalCues": ["..."], "buzzwords": ["..."], "testableDetails": ["..."], "exceptions": ["..."], "quantitativeDetails": ["..."], "inheritancePattern": "..." } ] }.
Up to 40 atoms per segment. Prefer several precise atoms over one overloaded summary atom.`;

export async function extractTypedHighYield(lectureText, lecInfo = {}, deps = {}) {
  const {
    callAIJSON,
    maxTokens = 4000,
    timeoutMs = EXTRACTION_TIMEOUT_MS,
    bridgeTimeoutMs = EXTRACTION_BRIDGE_TIMEOUT_MS,
    signal: parentSignal,
  } = deps;
  const fullText = String(lectureText || "");
  if (fullText.length < 200) return { error: "Not enough lecture text — re-upload/convert the PDF first.", atoms: [] };

  const normalizeResponse = (result) => {
    const direct = result?.atoms || result?.highYieldAtoms || result?.high_yield_atoms
      || result?.facts || result?.details || result?.data?.atoms || result;
    if (Array.isArray(direct)) return normalizeHighYield(direct);

    // Some models group otherwise-valid atoms by taxonomy instead of repeating
    // `type` on every row. Accept that harmless shape rather than discarding it.
    if (direct && typeof direct === "object") {
      const grouped = [];
      for (const type of ["definition", "mechanism", "relationship", "result"]) {
        const rows = direct[type] || direct[`${type}s`];
        if (!Array.isArray(rows)) continue;
        grouped.push(...rows.map((row) => typeof row === "string"
          ? { type, term: row.split(/[:—-]/, 1)[0], content: row }
          : { ...row, type: row?.type || type }));
      }
      return normalizeHighYield(grouped);
    }
    return [];
  };

  const runWindow = async (text, retry = false, signal) => {
    const user = `Lecture: ${lecInfo.lectureTitle || lecInfo.filename || "Untitled"}
Type: ${lecInfo.lectureType || "LEC"}

${retry ? "The earlier content window produced no usable atoms. Extract concrete testable facts from this window; do not return an empty list when medical facts are present.\n\n" : ""}LECTURE CONTENT (markdown — bolded terms appear inside **double asterisks**; tables, headings, arrows, units, and slide emphasis are evidence):
${text}`;
    const result = await callAIJSON(SYSTEM, user, { atoms: [] }, maxTokens, undefined, undefined, {
      throwOnError: true,
      bridgeTimeoutMs,
      signal,
    });
    return normalizeResponse(result);
  };

  try {
    return await withDeadline(async (signal) => {
      const evidenceWindows = buildExtractionWindows(fullText);
      let atoms = [];
      let firstError = null;
      let firstAttemptCompleted = false;
      for (const [index, evidenceWindow] of evidenceWindows.entries()) {
        try {
          atoms.push(...await runWindow(evidenceWindow, false, signal));
          firstAttemptCompleted = true;
        } catch (error) {
          firstError ||= error;
        }
        if (index === 0 && firstAttemptCompleted && !atoms.length && evidenceWindows.length === 1) {
          // Slide decks commonly put objectives/logistics first and the actual
          // mechanisms later. Retry the same short document with a stricter
          // instruction before declaring extraction empty.
          try {
            atoms = await runWindow(evidenceWindow, true, signal);
          } catch (error) {
            firstError ||= error;
          }
        }
      }
      if (!atoms.length && firstError) throw firstError;
      return { atoms: normalizeHighYield(atoms) };
    }, timeoutMs, parentSignal, "Lecture extraction");
  } catch (e) {
    return { error: e?.message || String(e), atoms: [] };
  }
}
