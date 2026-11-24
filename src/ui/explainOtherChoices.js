// On-request "why not" notes for answer choices the source rationale never
// explains. Written by the AI, labelled as such, and cached per question so a
// question is only asked about once on this device.
const PREFIX = "rxt-ai-choice-notes:";

export function readCachedChoiceNotes(questionKey) {
  try { return JSON.parse(localStorage.getItem(PREFIX + questionKey) || "null") || {}; } catch { return {}; }
}
export function saveCachedChoiceNotes(questionKey, notes) {
  try { localStorage.setItem(PREFIX + questionKey, JSON.stringify(notes)); } catch { /* optional cache */ }
}

export function buildOtherChoicesPrompt(question, missing, knownNotes = {}) {
  const choices = Object.entries(question.choices || {}).map(([letter, value]) => `${letter}. ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n");
  const known = Object.entries(knownNotes).map(([letter, note]) => `${letter}: ${note}`).join("\n");
  return `Question stem:\n${question.stem}\n\nAnswer choices:\n${choices}\n\nKeyed correct answer: ${question.correct}\n\n`
    + (question.explanation ? `Source rationale (authoritative):\n${question.explanation}\n\n` : "")
    + (known ? `Existing choice notes:\n${known}\n\n` : "")
    + `For each of these choices: ${missing.join(", ")}, write one short sentence (max 35 words) explaining why it is NOT the best answer for THIS patient, `
    + `naming the finding or principle it conflicts with. Stay consistent with the keyed answer and the source rationale; do not introduce facts that contradict them. `
    + `Return only JSON: {"notes":{"B":"...","C":"..."}}`;
}

/** Keep only notes for the requested wrong choices, as plain trimmed text. */
export function acceptedChoiceNotes(raw, missing = []) {
  const notes = raw?.notes && typeof raw.notes === "object" ? raw.notes : {};
  return Object.fromEntries(missing.map((letter) => [letter, String(notes[letter] || "").replace(/\s+/g, " ").trim()]).filter(([, note]) => note.length >= 8).map(([letter, note]) => [letter, note.slice(0, 400)]));
}
