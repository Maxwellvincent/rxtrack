/** Page running heads can be joined to the last option during PDF extraction.
 * Strip only an explicit trailing question-range header, never clinical numbers.
 * Keep the extracted choices available for source comparison. */
export function cleanSchoolQuestion(question) {
  if (!question?.choices || typeof question.choices !== "object") return question;
  let changed = false;
  const choices = Object.fromEntries(Object.entries(question.choices).map(([letter, value]) => {
    if (typeof value !== "string") return [letter, value];
    const cleaned = value.replace(/\s+Questions\s+\d{1,4}\s*[.:–—-]\s*\d{1,4}\s*$/i, "").trim();
    changed ||= cleaned !== value;
    return [letter, cleaned];
  }));
  return changed ? { ...question, choices, sourceChoiceText: question.sourceChoiceText || question.choices } : question;
}
