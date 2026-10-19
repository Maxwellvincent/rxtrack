/** Explanation handouts contain abbreviated prompts, not original exam vignettes.
 * Split each option from its rationale locally and retain the supplied key.
 * Never borrow rationale text to invent missing clinical premises or exhibits. */
export function parseAnswerExplanations(text, title = "") {
  const source = String(text || "").replace(/\r/g, "");
  const headings = [...source.matchAll(/(?:^|\n|\f)\s*Q(\d{1,3})\s*[—–-]\s*([\s\S]*?)\(\s*Answer\s*:\s*([A-H])\s*\)/gi)];
  if (!headings.length || !/[✓✔✗✘]/u.test(source)) return null;
  const clean = value => value.replace(/\[PAGE_BREAK:\d+\]/g, " ").replace(/\s+/g, " ").trim();
  const questions = [];
  const sourceIssues = [];
  const seen = new Set();
  for (const [index, heading] of headings.entries()) {
    const num = Number(heading[1]);
    const summary = clean(heading[2]);
    const correct = heading[3].toUpperCase();
    const body = source.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? source.length);
    const options = [...body.matchAll(/(?:^|\n|\f)\s*[•●]?\s*([A-H])\s*([✓✔✗✘])\s*[—–-]\s*/gu)];
    const choices = {};
    const explanations = {};
    let malformed = false;
    const marked = [];
    for (const [optionIndex, option] of options.entries()) {
      const letter = option[1];
      const content = clean(body.slice(option.index + option[0].length, options[optionIndex + 1]?.index ?? body.length));
      // Delimiters are spaced: keep hyphenated choices such as after-hyperpolarization.
      const separator = content.match(/\s+[—–-]\s+/u);
      if (!separator || choices[letter]) { malformed = true; continue; }
      choices[letter] = content.slice(0, separator.index).trim();
      explanations[letter] = content.slice(separator.index + separator[0].length).trim();
      if (!choices[letter] || !explanations[letter]) malformed = true;
      if (/[✓✔]/u.test(option[2])) marked.push(letter);
    }
    const letters = Object.keys(choices);
    const contiguous = letters.every((letter, i) => letter === String.fromCharCode(65 + i));
    let reason = null;
    if (seen.has(num)) reason = "duplicate question number";
    else if (malformed || letters.length < 2 || !contiguous || !choices[correct]) reason = "incomplete option/explanation structure";
    else if (marked.length !== 1 || marked[0] !== correct) reason = "conflicting answer markers";
    else if (/\b(?:indicated|shown|pictured|histology|photomicrograph|diagram|image|figure|labeled)\b/i.test(summary)
      || letters.every(letter => /^[A-H0-9]+$/.test(choices[letter]))) reason = "required original figure or labeled exhibit is absent from this explanation handout";
    seen.add(num);
    if (reason) { sourceIssues.push(`Q${num}: ${reason}`); continue; }
    const before = source.slice(0, heading.index + heading[0].length);
    const pageMarkers = [...before.matchAll(/\[PAGE_BREAK:(\d+)\]/g)];
    const sourcePage = pageMarkers.length ? Number(pageMarkers.at(-1)[1]) : before.split("\f").length;
    questions.push({
      id: `q${num}`, num, stem: `${summary.replace(/[?.]+$/, "")}. Which option best answers this review prompt?`,
      choices, correct, explanation: letters.map(letter => `${letter}. ${choices[letter]} — ${explanations[letter]}`).join("\n\n"),
      choiceExplanations: explanations,
      sourceKind: "supplemental", sourcePromptSummary: summary, sourceRepresentation: "answer-explanation-summary",
      source: "Explanation-based review (abbreviated prompt)",
      sourceKeyStatus: "present", answerKeyVerified: true,
      sourcePage, hasImage: false, imageDependent: false,
      type: "recall", orderLevel: 1, difficulty: "medium", subject: "Uploaded", topic: title || "Explanation review",
    });
  }
  return { questions, sourceIssues, sourceQuestionCount: headings.length };
}
