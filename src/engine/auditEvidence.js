const START = "SOURCE EVIDENCE CATALOG:\n";
const END = "\nEND SOURCE EVIDENCE CATALOG";
const normalize = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

const SCHOOL_EVIDENCE_LIMIT = 8;
const ATOM_EVIDENCE_LIMIT = 24;
const bounded = (value, limit) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);

const trustedSchoolRows = cfg => {
  const targetIds = new Set((cfg.objectives || []).flatMap(objective => [objective.id, objective.code]).filter(Boolean).map(String));
  return (cfg.examples || []).filter(question => question?.factualAuthority === true
  && question.correct && question.choices?.[question.correct]).map((question, index) => {
  const answer = question.choices[question.correct];
  const renderedAnswer = answer && typeof answer === "object"
    ? Object.entries(answer).map(([key, value]) => `${key}: ${value}`).join("; ") : String(answer);
  const sourceIds = [...(question.objectiveIds || []), ...(question.schoolObjectiveCodes || []), question.schoolObjectiveCode].filter(Boolean).map(String);
  return { index, relevant: sourceIds.some(id => targetIds.has(id)), text: bounded(`${question.stem} Correct answer: ${renderedAnswer}.${question.explanation ? ` ${question.explanation}` : ""}`, 2400) };
  }).sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.index - b.index)
    .slice(0, SCHOOL_EVIDENCE_LIMIT).map(row => row.text);
};

// Lecture spans must occur in the original text. Extracted facts are labeled
// separately; retrieval labels and objective-only statements are not evidence.
export function numberedAuditEvidence(cfg, retrieved) {
  const lecture = normalize(cfg.lectureText);
  const objectiveTexts = new Set((cfg.objectives || []).map(o => normalize(o.objective || o.text)));
  const spans = String(retrieved || "").split(/\[(?:Lecture excerpt \d+|Source-verified quote context)\]\n/)
    .map(text => text.trim()).filter(text => text.length >= 16 && lecture.includes(normalize(text)) && !objectiveTexts.has(normalize(text)));
  const targetIds = new Set((cfg.objectives || []).flatMap(objective => [objective.id, objective.code]).filter(Boolean).map(String));
  const atoms = (cfg.atoms || []).map((atom, index) => ({ atom, index,
    relevant: (atom.objectiveIds || []).some(id => targetIds.has(String(id))) }))
    .sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.index - b.index)
    .slice(0, ATOM_EVIDENCE_LIMIT).map(row => row.atom);
  for (const atom of atoms) {
    const text = bounded(`${atom.term || ""} ${atom.content || ""}`, 1200);
    if (text.length >= 16 && !objectiveTexts.has(normalize(text))) spans.push(text);
  }
  const schoolRows = trustedSchoolRows(cfg);
  for (const text of schoolRows) if (text.length >= 16) spans.push(text);
  const unique = [...new Map(spans.map(text => [normalize(text), text])).values()];
  const school = new Set(schoolRows.map(normalize));
  return START + JSON.stringify(unique.map((text, index) => ({ id: `E${index + 1}`, origin: lecture.includes(normalize(text)) ? "lecture" : school.has(normalize(text)) ? "trusted-school-question" : "extracted-fact", text }))) + END;
}

export function resolveAuditEvidence(result, prompt) {
  const start = String(prompt).indexOf(START);
  if (start < 0) return result;
  const end = prompt.indexOf(END, start);
  let catalog;
  try { catalog = JSON.parse(prompt.slice(start + START.length, end)); } catch { return result; }
  const byId = new Map(catalog.map(entry => [entry.id, entry.text]));
  return { ...result, reviews: (result?.reviews || []).map(review => {
    const ids = review.reasoning?.evidenceIds;
    if (!Array.isArray(ids)) return review; // Legacy exact quotations still verified.
    // An unknown ID invalidates the whole evidence claim, not just one citation.
    const valid = ids.length > 0 && ids.every(id => typeof id === "string" && byId.has(id));
    return { ...review, reasoning: { ...review.reasoning, sourceQuotes: valid ? [...new Set(ids)].map(id => byId.get(id)) : [] } };
  }) };
}
