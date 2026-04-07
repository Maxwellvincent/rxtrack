/** Pure helpers for lecture → objective AI text (testable, no React). */

export function prepareTextForObjectiveExtraction(rawText) {
  if (!rawText) return "";
  return rawText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Prefer full chunk-joined body when chunks exist; otherwise use prepared raw lecture text.
 * `getChunkBody` is optional (e.g. from lectureText.js).
 */
export function buildFullTextForObjectiveAi(fullTextPrepared, chunks, getChunkBody) {
  const chunkJoinedFull = (chunks || [])
    .map((c) => (typeof getChunkBody === "function" ? getChunkBody(c) || "" : "") || c.markdown || c.text || "")
    .join("\n");
  if (chunkJoinedFull.trim().length > 0) {
    return prepareTextForObjectiveExtraction(chunkJoinedFull);
  }
  return prepareTextForObjectiveExtraction(fullTextPrepared || "");
}

export const OBJECTIVE_AI_MAX_SECTION = 6000;
export const OBJECTIVE_AI_OVERLAP = 500;

/** Non-overlapping first slice is [0, maxSection); then step by (maxSection - overlap). */
export function getSequentialObjectiveSlices(
  fullTextForAi,
  maxSection = OBJECTIVE_AI_MAX_SECTION,
  overlap = OBJECTIVE_AI_OVERLAP
) {
  if (!fullTextForAi) return [];
  if (fullTextForAi.length <= maxSection) return [fullTextForAi];
  const slices = [];
  let pos = 0;
  while (pos < fullTextForAi.length) {
    slices.push(fullTextForAi.slice(pos, pos + maxSection));
    pos += maxSection - overlap;
  }
  return slices;
}
