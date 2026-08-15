const SYSTEM = "You are a USMLE Step 1 curriculum organizer. Return ONLY valid JSON — no markdown, no prose.";

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
    `Build a master study guide for "${blockName}" from these lecture study topics.\n\n` +
    `Rules:\n` +
    `- Organize into relevant medical education groups: ${CATEGORY_ORDER.join(", ")}\n` +
    `- Only include groups that have content — skip empty ones\n` +
    `- DEDUPLICATE: if multiple lectures cover the same concept (e.g. "aldosterone production"), merge into ONE topic and include ALL source IDs\n` +
    `- Each output topic must reference ALL sourceIds that map to it (include every sourceId from the input that this topic covers)\n` +
    `- Topic text: clear 3-7 word searchable phrase (e.g. "renin-angiotensin-aldosterone system", "cortisol mechanism of action")\n` +
    `- Order topics within each group: fundamental → applied\n` +
    `- Think about what the lectures are building toward — identify the arc\n\n` +
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
  const { callAIJSON, maxTokens = 2500 } = deps;
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
