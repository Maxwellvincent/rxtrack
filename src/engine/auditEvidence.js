const START = "SOURCE EVIDENCE CATALOG:\n";
const END = "\nEND SOURCE EVIDENCE CATALOG";
const normalize = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

// Only actual source spans enter the catalog. Retrieval labels, objective-only
// scope statements and generator-provided quotations are not evidence.
export function numberedAuditEvidence(cfg, retrieved) {
  const lecture = normalize(cfg.lectureText);
  const objectiveTexts = new Set((cfg.objectives || []).map(o => normalize(o.objective || o.text)));
  const spans = String(retrieved || "").split(/\[(?:Lecture excerpt \d+|Source-verified quote context)\]\n/)
    .map(text => text.trim()).filter(text => text.length >= 16 && lecture.includes(normalize(text)) && !objectiveTexts.has(normalize(text)));
  for (const atom of cfg.atoms || []) {
    const text = `${atom.term || ""} ${atom.content || ""}`.trim();
    if (text.length >= 16 && !objectiveTexts.has(normalize(text))) spans.push(text);
  }
  const unique = [...new Map(spans.map(text => [normalize(text), text])).values()];
  return START + JSON.stringify(unique.map((text, index) => ({ id: `E${index + 1}`, text }))) + END;
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
