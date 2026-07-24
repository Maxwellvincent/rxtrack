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
  const text = String(lectureText || "").slice(0, 12000);
  if (text.length < 200) return { error: "Not enough lecture text — re-upload/convert the PDF first.", atoms: [] };

  const user = `Lecture: ${lecInfo.lectureTitle || lecInfo.filename || "Untitled"}
Type: ${lecInfo.lectureType || "LEC"}

LECTURE CONTENT (markdown — bolded terms appear inside **double asterisks**):
${text}`;

  try {
    const result = await callAIJSON(SYSTEM, user, { atoms: [] }, maxTokens);
    const atoms = normalizeHighYield(result?.atoms || result?.details || result);
    return { atoms };
  } catch (e) {
    return { error: e?.message || String(e), atoms: [] };
  }
}
