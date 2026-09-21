// highYield.js — the typed high-yield taxonomy for lecture extraction.
// Louis's signal-vs-fluff schema: every atom is ONE of four testable kinds.
//   definition   — what something IS
//   mechanism    — how it works (MOA / process)
//   relationship — how one thing relates to another
//   result       — the outcome/consequence of a process
// Everything else (history, filler, motivation) is fluff and dropped.

export const HY_TYPES = ["definition", "mechanism", "relationship", "result"];

// Map common model synonyms onto the canonical types.
const SYNONYMS = {
  def: "definition", definition: "definition",
  moa: "mechanism", mechanism: "mechanism", process: "mechanism", "mechanism of action": "mechanism",
  relationship: "relationship", relation: "relationship", association: "relationship",
  result: "result", outcome: "result", consequence: "result", effect: "result",
};

const MAX = 60;

function stringList(value, limit, maxLength = 180) {
  const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return values.map(String).map((entry) => entry.trim()).filter(Boolean).slice(0, limit).map((entry) => entry.slice(0, maxLength));
}

export function normalizeHighYield(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const type = SYNONYMS[String(item.type || "").trim().toLowerCase()];
    if (!type) continue;
    const term = String(item.term || item.name || "").trim();
    const content = String(item.content || item.fact || item.detail || "").trim();
    if (!term || !content) continue;
    const key = type + "::" + term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const normalized = { type, term: term.slice(0, 140), content: content.slice(0, 400) };
    const clinicalCorrelate = String(item.clinicalCorrelate || item.clinical || "").trim();
    const clinicalCues = stringList(item.clinicalCues, 6);
    const buzzwords = stringList(item.buzzwords, 8);
    const testableDetails = stringList(item.testableDetails || item.characteristics || item.details, 10);
    const exceptions = stringList(item.exceptions || item.exclusions, 5);
    const quantitativeDetails = stringList(item.quantitativeDetails || item.thresholds || item.values, 6);
    const objectiveCodes = stringList(item.objectiveCodes || item.objectives, 12, 120);
    const inheritancePattern = String(item.inheritancePattern || "").trim();
    if (clinicalCorrelate) normalized.clinicalCorrelate = clinicalCorrelate.slice(0, 360);
    if (clinicalCues.length) normalized.clinicalCues = clinicalCues;
    if (buzzwords.length) normalized.buzzwords = buzzwords;
    if (testableDetails.length) normalized.testableDetails = testableDetails;
    if (exceptions.length) normalized.exceptions = exceptions;
    if (quantitativeDetails.length) normalized.quantitativeDetails = quantitativeDetails;
    if (objectiveCodes.length) normalized.objectiveCodes = objectiveCodes;
    if (inheritancePattern) normalized.inheritancePattern = inheritancePattern.slice(0, 180);
    out.push(normalized);
    if (out.length >= MAX) break;
  }
  // Stable order by the canonical type sequence, preserving encounter order within a type.
  return HY_TYPES.flatMap((t) => out.filter((a) => a.type === t));
}
