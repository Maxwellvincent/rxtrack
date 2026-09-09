#!/usr/bin/env node
/** Build a conservative LoRA/SFT dataset from reviewed ExamSoft/IMCQ items.
 * Input: JSON or JSONL containing questions, or { questions, ratings }.
 * Output: JSONL chat records suitable for common Ollama/Unsloth adapters.
 */
import fs from "node:fs";
import path from "node:path";

const [inputPath, outputPath = "tmp/style-training.jsonl"] = process.argv.slice(2);
if (!inputPath) {
  console.error("Usage: node scripts/build-style-dataset.mjs <questions.json|jsonl> [output.jsonl]");
  process.exit(2);
}

const raw = fs.readFileSync(inputPath, "utf8").trim();
const parsed = raw.startsWith("[") || raw.startsWith("{") ? JSON.parse(raw) : raw.split(/\r?\n/).filter(Boolean).map(JSON.parse);
const questions = Array.isArray(parsed) ? parsed : parsed.questions || [];
const ratings = Array.isArray(parsed?.ratings) ? parsed.ratings : Object.values(parsed?.ratings || {});
const ratingById = new Map(ratings.map((r) => [String(r.questionId || ""), r]));

const isReference = (q) => {
  const label = [q.sourceFile, q.filename, q.bankTitle, q.title].filter(Boolean).join(" ").toLowerCase();
  return /examsoft|esoft|imcq/.test(label) || q.sourceKind === "imcq";
};
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const records = [];
for (const q of questions) {
  const rating = ratingById.get(String(q.id || q.questionId || ""));
  const choices = q.choices && typeof q.choices === "object" ? q.choices : null;
  if (!isReference(q) || !clean(q.stem) || !choices || !q.correct || !clean(choices[q.correct])) continue;
  if (q.qualityAudit?.status && !["approved", "source-grounded"].includes(q.qualityAudit.status)) continue;
  if (rating && (rating.fair === false || rating.examStyle === false || rating.issue)) continue;
  const answer = Object.entries(choices).map(([letter, text]) => `${letter}. ${clean(text)}`).join("\n");
  records.push({ messages: [
    { role: "system", content: "Write one new SGU Basic Principles of Medicine question. Match the reference item's vignette length, clinical/anatomic framing, lead-in, reasoning depth, answer-choice category, and distractor style. Do not copy the scenario. Use only the supplied lecture facts for medical content. Return JSON with stem, choices, correct, explanation, objectiveIds, and taskType." },
    { role: "user", content: `REFERENCE STYLE ITEM:\n${clean(q.stem)}\n${answer}\n\nCreate a new item with the same writing style.` },
    { role: "assistant", content: JSON.stringify({ stem: clean(q.stem), choices: Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, clean(v)])), correct: q.correct, explanation: clean(q.explanation), objectiveIds: q.objectiveIds || [], taskType: q.taskType || "clinical-application" }) },
  ] });
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
console.log(`Wrote ${records.length} conservative style records to ${outputPath}`);
