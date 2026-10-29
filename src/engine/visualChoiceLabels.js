// Recover only labels actually retained from a source diagram. Never extend text choices.
export function restoreVisualChoices(question) {
  const choices = question?.choices || {};
  if (!Object.keys(choices).length || !Object.entries(choices).every(([key, value]) => value === `Visual option ${key}`)) return question;
  const tail = String(question.stem || "").match(/(?:\s+[A-H]){2,}\s*$/)?.[0] || "";
  const labels = [...tail.matchAll(/\b([A-H])\b/g)].map(match => match[1]);
  if (!labels.includes("A")) return question;
  const last = Math.max(...labels.map(letter => letter.charCodeAt(0) - 65));
  if (last < Object.keys(choices).length) return question;
  const restored = {...choices};
  for (let i = 0; i <= last; i++) restored[String.fromCharCode(65 + i)] = `Visual option ${String.fromCharCode(65 + i)}`;
  return {...question, choices: restored};
}
