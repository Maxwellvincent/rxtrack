// extractHighYield.js — AI extraction of typed high-yield atoms from a lecture.
// callAIJSON is injected (real one is ../aiClient.js) so the logic is testable
// without a live model. Returns { atoms } or { error }.
import { normalizeHighYield } from "./highYield.js";

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
- Keep "content" one tight sentence.

Return ONLY valid JSON: { "atoms": [ { "type": "...", "term": "...", "content": "..." } ] }.
Up to 40 atoms.`;

export async function extractTypedHighYield(lectureText, lecInfo = {}, deps = {}) {
  const { callAIJSON, maxTokens = 4000 } = deps;
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

  const runWindow = async (text, retry = false) => {
    const user = `Lecture: ${lecInfo.lectureTitle || lecInfo.filename || "Untitled"}
Type: ${lecInfo.lectureType || "LEC"}

${retry ? "The earlier content window produced no usable atoms. Extract concrete testable facts from this window; do not return an empty list when medical facts are present.\n\n" : ""}LECTURE CONTENT (markdown — bolded terms appear inside **double asterisks**):
${text}`;
    const result = await callAIJSON(SYSTEM, user, { atoms: [] }, maxTokens, undefined, undefined, { throwOnError: true });
    return normalizeResponse(result);
  };

  try {
    let atoms = await runWindow(fullText.slice(0, 12000));
    if (!atoms.length) {
      // Slide decks commonly put objectives/logistics first and the actual
      // mechanisms later. Retry the tail (or the same short document with a
      // stricter instruction) before declaring extraction empty.
      atoms = await runWindow(fullText.length > 12000 ? fullText.slice(-12000) : fullText, true);
    }
    return { atoms };
  } catch (e) {
    return { error: e?.message || String(e), atoms: [] };
  }
}
