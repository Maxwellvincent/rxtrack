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
  const beforeFinal = text.slice(0, Math.max(0, text.length - 1));
  const boundary = Math.max(beforeFinal.lastIndexOf("?"), beforeFinal.lastIndexOf("."), beforeFinal.lastIndexOf("!"));
  return text.slice(boundary + 1).trim();
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
