// mentalModel.js — builds a reasoning framework from a lecture's extracted atoms:
// big picture -> components -> relationships -> mechanisms/flows -> cause-and-effect ->
// clinical application. Not a summary — every node is meant to have atoms attached to it.
const SYSTEM = `You build a mental model — a reasoning framework, NOT a summary — from high-yield
medical atoms for USMLE Step 1 study. A summary restates facts; a framework shows how they connect
and WHY, so a student can reason from it instead of recalling it.

Organize strictly in this order:
1. bigPicture — 2-3 sentences: what system/process this lecture is about and why it matters clinically.
2. components — the actors/entities involved (cells, molecules, organs, drug classes...).
3. relationships — how components connect, regulate, or affect each other. Every relationship MUST
   include WHY it exists (the underlying logic/design reason), not just that it exists.
4. mechanisms — step-by-step flows (a pathway, a process, a mechanism of action).
5. causeEffect — cause -> effect chains, each with WHY that effect follows from that cause.
6. clinicalApplication — how this shows up in a patient/exam question.
7. confusedPairs — concepts students commonly mix up, each with the ONE distinguishing feature.

Every node that maps to a specific atom MUST list its "atomTerms" (matching the atom "term" fields
given), so atoms can be attached to the framework. Nodes with no matching atom get atomTerms: [].
Be concise per line — this is a skeleton to reason from, not prose to read once and discard.

Return ONLY valid JSON:
{
  "bigPicture": "...",
  "components": [{ "name": "...", "role": "...", "atomTerms": ["..."] }],
  "relationships": [{ "from": "...", "to": "...", "connection": "...", "why": "...", "atomTerms": ["..."] }],
  "mechanisms": [{ "name": "...", "steps": ["...", "..."], "atomTerms": ["..."] }],
  "causeEffect": [{ "cause": "...", "effect": "...", "why": "...", "atomTerms": ["..."] }],
  "clinicalApplication": [{ "scenario": "...", "connection": "...", "atomTerms": ["..."] }],
  "confusedPairs": [{ "a": "...", "b": "...", "distinction": "..." }]
}`;

export function buildMentalModelPrompt({ atoms = [], subject = "this lecture" } = {}) {
  const atomLines = atoms
    .slice(0, 40)
    .map((a) => `[${a.type}] ${a.term}: ${a.content}`);

  return (
    `Build the mental-model framework for "${subject}" from these extracted atoms.\n\n` +
    `ATOMS:\n${atomLines.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n` +
    `Use each atom's exact "term" text in atomTerms when it belongs to a node. Do not invent atoms ` +
    `that aren't in the list above.`
  );
}

const EMPTY_MODEL = {
  bigPicture: "",
  components: [],
  relationships: [],
  mechanisms: [],
  causeEffect: [],
  clinicalApplication: [],
  confusedPairs: [],
};

export async function generateMentalModel({ atoms = [], subject = "this lecture" } = {}, deps = {}) {
  const { callAIJSON, maxTokens = 3000 } = deps;
  if (!atoms.length) return { error: "Nothing to build a framework from — extract atoms first.", model: null };
  try {
    const prompt = buildMentalModelPrompt({ atoms, subject });
    const result = await callAIJSON(SYSTEM, prompt, EMPTY_MODEL, maxTokens);
    const model = {
      bigPicture: typeof result?.bigPicture === "string" ? result.bigPicture : "",
      components: Array.isArray(result?.components) ? result.components : [],
      relationships: Array.isArray(result?.relationships) ? result.relationships : [],
      mechanisms: Array.isArray(result?.mechanisms) ? result.mechanisms : [],
      causeEffect: Array.isArray(result?.causeEffect) ? result.causeEffect : [],
      clinicalApplication: Array.isArray(result?.clinicalApplication) ? result.clinicalApplication : [],
      confusedPairs: Array.isArray(result?.confusedPairs) ? result.confusedPairs : [],
    };
    const hasContent = model.bigPicture || model.components.length || model.relationships.length
      || model.mechanisms.length || model.causeEffect.length || model.clinicalApplication.length;
    if (!hasContent) return { error: "No framework came back — try again.", model: null };
    return { model, generated: Date.now() };
  } catch (e) {
    return { error: e?.message || String(e), model: null };
  }
}
