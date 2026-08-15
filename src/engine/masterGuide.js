const SYSTEM = "You are a USMLE Step 1 curriculum architect. Return ONLY valid JSON — no markdown, no prose.";

const CATEGORY_ORDER = [
  "Foundation & Background",
  "Anatomy & Histology",
  "Physiology",
  "Mechanisms",
  "Pathology & Disease Processes",
  "Clinical Manifestations",
  "Complications",
  "Pharmacology & Treatment",
];

export function buildMasterGuidePrompt({ lectureTopics, blockName }) {
  const input = lectureTopics
    .filter((lt) => lt.topics.length > 0)
    .map((lt) => ({
      lectureId: lt.lectureId,
      lecture: lt.lectureName,
      topics: lt.topics.map((t) => ({ sourceId: `${lt.lectureId}:${t.id}`, text: t.text })),
    }));

  return (
    `You are building a subject-level mindmap study guide for a USMLE Step 1 student studying "${blockName}".\n\n` +
    `Think like a professor who has taught this module many times. Look at ALL the lecture topics and ask:\n` +
    `"What are the 5-12 MASTER CONCEPTS a student must truly own to pass Step 1 on this module?"\n\n` +
    `Each output topic must be:\n` +
    `- A SPECIFIC, ACTIONABLE study task — not a keyword, but a directive\n` +
    `- Written as "Know/Trace/Compare/Explain [specific thing]" — e.g.:\n` +
    `  ✓ "Trace the steroid synthesis pathway from cholesterol to all end products"\n` +
    `  ✓ "Know all adrenal cortex zones: what each secretes and the key regulator"\n` +
    `  ✓ "Explain how cortisol mediates its anti-inflammatory effects (mechanism)"\n` +
    `  ✓ "Compare Cushing syndrome vs Cushing disease: cause, ACTH level, treatment"\n` +
    `  ✗ "cortisol mechanism" — too vague\n` +
    `  ✗ "aldosterone production" — too vague\n` +
    `- Concrete enough that a student knows EXACTLY what to study\n` +
    `- If multiple source topics all feed into one master concept, MERGE them into one output topic\n\n` +
    `Rules:\n` +
    `- Organize into these groups (skip empty ones): ${CATEGORY_ORDER.join(", ")}\n` +
    `- DEDUPLICATE aggressively — one master task per concept regardless of how many lectures touched it\n` +
    `- Each output topic MUST list ALL sourceIds from the input that contribute to it\n` +
    `- Order topics within each group: foundation → applied → clinical\n` +
    `- Aim for 3-8 topics per group — quality over quantity\n\n` +
    `Source topics:\n${JSON.stringify(input, null, 2)}\n\n` +
    `Return ONLY valid JSON:\n` +
    `{ "groups": [{ "name": "...", "topics": [{ "text": "...", "sourceIds": ["lectureId:topicId", ...] }] }] }`
  );
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

export async function generateMasterGuide(
  { lectureTopics, blockName, blockId },
  deps = {}
) {
  const { callAIJSON, maxTokens = 4000 } = deps;
  if (!lectureTopics.some((lt) => lt.topics.length > 0)) {
    return { error: "No lecture study guides generated yet — study some lectures first.", groups: [] };
  }

  // Build a valid sourceId set for validation
  const validSourceIds = new Set(
    lectureTopics.flatMap((lt) => lt.topics.map((t) => `${lt.lectureId}:${t.id}`))
  );

  try {
    const prompt = buildMasterGuidePrompt({ lectureTopics, blockName });
    const result = await callAIJSON(SYSTEM, prompt, { groups: [] }, maxTokens);

    if (!Array.isArray(result?.groups)) {
      return { error: "Unexpected response format.", groups: [] };
    }

    // Sanitize: filter invalid sourceIds, assign stable IDs
    const groups = result.groups
      .filter((g) => g?.name && Array.isArray(g.topics) && g.topics.length > 0)
      .map((g) => ({
        id: slugify(g.name),
        name: g.name,
        topics: (g.topics || [])
          .filter((t) => typeof t?.text === "string" && t.text.trim())
          .map((t) => ({
            id: makeId(),
            text: t.text.trim(),
            checked: false,
            sourceIds: (t.sourceIds || []).filter((sid) => validSourceIds.has(sid)),
          })),
      }))
      .filter((g) => g.topics.length > 0);

    // Sort groups by canonical category order
    groups.sort((a, b) => {
      const ai = CATEGORY_ORDER.findIndex((c) => a.name.toLowerCase().includes(c.split(" ")[0].toLowerCase()));
      const bi = CATEGORY_ORDER.findIndex((c) => b.name.toLowerCase().includes(c.split(" ")[0].toLowerCase()));
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    return { groups, blockId, blockName, generatedAt: new Date().toISOString() };
  } catch (e) {
    return { error: e?.message || String(e), groups: [] };
  }
}
