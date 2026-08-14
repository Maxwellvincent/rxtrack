const SYSTEM = "You are a USMLE Step 1 study guide generator. Return ONLY valid JSON — no markdown, no prose.";

export function buildStudyGuidePrompt({ objectives = [], atoms = [], subject = "this lecture" } = {}) {
  const objLines = objectives
    .map((o) => o.objective || o.text || "")
    .filter((s) => s.trim().length > 5)
    .slice(0, 40);

  const atomLines = atoms
    .slice(0, 30)
    .map((a) => `[${a.type}] ${a.term}: ${a.content}`);

  const objSection = objLines.length
    ? `LEARNING OBJECTIVES:\n${objLines.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  const atomSection = atomLines.length
    ? `KEY FACTS:\n${atomLines.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  return (
    `Generate 5–10 plain, searchable study topics for a medical student studying "${subject}" for USMLE Step 1.\n\n` +
    `Each topic is a short phrase (3–7 words) the student would type into YouTube or Google.\n` +
    `Examples: "steroid mechanism of action", "beta-lactam resistance mechanisms", "renin-angiotensin-aldosterone system", "T cell activation pathway"\n` +
    `Focus on: mechanisms, drug classes, signaling pathways, disease processes, clinical concepts.\n` +
    `Do NOT copy objective text verbatim — distill to the searchable core concept.\n` +
    `Order from most fundamental to most specialized.\n\n` +
    (objSection ? objSection + "\n\n" : "") +
    (atomSection ? atomSection + "\n\n" : "") +
    `Return ONLY valid JSON: {"topics": ["...", "..."]}`
  );
}

export async function generateStudyGuide(
  { objectives = [], atoms = [], subject = "this lecture" } = {},
  deps = {}
) {
  const { callAIJSON, maxTokens = 1000 } = deps;
  if (!objectives.length && !atoms.length) {
    return { error: "Nothing to guide — extract atoms first.", topics: [] };
  }
  try {
    const prompt = buildStudyGuidePrompt({ objectives, atoms, subject });
    const result = await callAIJSON(SYSTEM, prompt, { topics: [] }, maxTokens);
    const topics = Array.isArray(result?.topics)
      ? result.topics.filter((t) => typeof t === "string" && t.trim())
      : [];
    return { topics };
  } catch (e) {
    return { error: e?.message || String(e), topics: [] };
  }
}
