/**
 * Shared generation contract for objectives that contain several assessable
 * asks. Objective IDs stay as the durable parent link; facet labels record the
 * particular clause tested by an individual question.
 */
export function objectiveFacetCoveragePrompt(objectives = [], questionCount = 0, { questionLinkField = "objectiveIds" } = {}) {
  const rows = (objectives || [])
    .map((objective, index) => ({
      id: objective?.id || objective?.code || `objective-${index + 1}`,
      text: String(objective?.objective || objective?.text || objective?.title || "").trim(),
    }))
    .filter((objective) => objective.text);
  if (!rows.length) return "";

  const count = Math.max(1, Number(questionCount) || 1);
  return `\n\nOBJECTIVE FACET COVERAGE (required):\n` +
    `Read each full objective and internally split it into distinct, independently assessable facets (for example: function/mechanism; synthesis or pathway relationships; deficiency pathophysiology; manifestations; diagnosis; management; comparisons explicitly named). Do not collapse a multi-clause objective into one generic question. For this ${count}-question request, first give each supported facet a question slot before repeating a facet, whenever the number of supported facets and lecture evidence allow. A broad objective may and should receive multiple questions, each with the SAME single primary objective ID but a DIFFERENT facet. Never attach unrelated objectives just to inflate coverage, and never invent content absent from lecture evidence. If there are more facets than available slots, prioritize the facets explicitly named by the objective and report only facets actually tested.\n` +
    `For every question, return ${questionLinkField} with exactly one valid primary objective ID and objectiveFacet as a concise label for the specific clause/task tested (about 2–8 words). The facet is descriptive metadata, not a replacement objective ID. Avoid repeating the same facet/clue-to-answer route within a batch unless a fresh-retest is explicitly requested.\n` +
    `OBJECTIVES TO DECOMPOSE:\n${rows.map((objective) => `- [${objective.id}] ${objective.text}`).join("\n")}\n`;
}
