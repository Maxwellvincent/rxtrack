export const ERROR_REASONS = [
  ["knowledge-gap", "Knowledge gap"],
  ["misread-lead-in", "Misread the lead-in"],
  ["missed-key-clue", "Missed a key clue"],
  ["distractor-confusion", "Distractor confusion"],
  ["overthinking", "Overthought it"],
  ["time-pressure", "Time pressure"],
];

export function extractLeadIn(stem) {
  const text = String(stem || "").trim();
  if (!text) return "";
  // Treat a trailing punctuation run as one terminator. Imported and fallback
  // questions can end in ".?"; slicing before only the final character made the
  // lead-in helper render a bare question mark.
  const match = text.match(/[.?!]+$/);
  const punctuation = match?.[0]?.includes("?") ? "?" : match?.[0]?.slice(-1) || "";
  const body = match ? text.slice(0, -match[0].length).trim() : text;
  const boundary = Math.max(body.lastIndexOf("?"), body.lastIndexOf("."), body.lastIndexOf("!"));
  const lead = body.slice(boundary + 1).trim() || body;
  return `${lead}${punctuation}`;
}

export function classifyLeadIn(stem) {
  const lead = extractLeadIn(stem).toLowerCase();
  if (/diagnos|condition|disorder/.test(lead)) return "diagnosis";
  if (/enzyme|reaction|pathway|conversion|metaboli/.test(lead)) return "enzyme-pathway";
  if (/mechanism|regulat|physiolog|\baction\b/.test(lead)) return "mechanism";
  if (/nerve|arter|vein|ligament|structure|anatomic|cell type|organ/.test(lead)) return "anatomy-structure";
  if (/treat|therapy|drug|management|next step/.test(lead)) return "treatment";
  if (/laborator|serum|finding|alteration|level|pattern/.test(lead)) return "lab-interpretation";
  return "other";
}
