const TRAILING_SOURCE = /\s+((?:underlying\s+(?:schematic|image|figure)|(?:image|figure|photograph|schematic)\s+(?:source|courtesy|adapted\s+from)|adapted\s+from)\b[\s\S]*)$/i;

export function splitQuestionStemSource(text = "") {
  const stem = String(text || "").trim();
  const match = stem.match(TRAILING_SOURCE);
  if (!match || !match.index) return { stem, sourceNote: "" };
  return {
    stem: stem.slice(0, match.index).trim(),
    sourceNote: match[1].trim(),
  };
}
