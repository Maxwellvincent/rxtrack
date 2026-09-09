/** Build a portable export of every uploaded ExamSoft/IMCQ style source. */
export function collectStyleSources(banks = {}, meta = {}, ratings = {}) {
  const ratingValues = Object.values(ratings || {});
  const ratingById = new Map(ratingValues.map((r) => [String(r.questionId || ""), r]));
  const rows = [];
  for (const [filename, questions] of Object.entries(banks || {})) {
    const label = filename.toLowerCase();
    if (!/examsoft|esoft|imcq/.test(label)) continue;
    for (const question of questions || []) {
      if (!question?.stem || !question?.choices) continue;
      rows.push({ ...question, sourceFile: question.sourceFile || filename, bankMeta: meta[filename] || null, rating: ratingById.get(String(question.id || question.questionId || "")) || null });
    }
  }
  return rows;
}

export function downloadStyleSources(rows, filename = "rxtrack-examsoft-imcq-style-sources.json") {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), questions: rows }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
