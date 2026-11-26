import { analyzeExamReportWeakConcepts, looksLikeExamReport, mergeExamReportConcepts, parseExamReportSummary } from "./examReportWeakConcepts.js";

/**
 * Import an ExamSoft "Strengths and Improvement Opportunities" score report
 * (ESoft quiz or NB main exam): save the overall result and turn categories
 * below the class average — or below the 80% goal when the report has no
 * average — into weak concepts for the chosen block. Nothing is written when
 * the file is not a score report.
 */
export async function importScoreReport({ file, text = null, userId, blockId, blockName = "", lectures = [], objectives = [] }, deps = {}) {
  if (!userId) throw new Error("Sign in to save score reports.");
  if (!blockId) throw new Error("Choose the block this report covers.");
  const extractText = deps.extractText || (async input => (await import("../../ingest/pdfText.js")).extractPdfTextFast(input));
  const reportText = text ?? await extractText(file);
  const summary = parseExamReportSummary(reportText, { blockId });
  if (!summary && !looksLikeExamReport(reportText)) throw new Error("This file is not an ExamSoft score report (expected “Strengths and Improvement Opportunities” with My Score and category rows).");
  const results = await loadDefaults(deps);
  if (summary) await results.writeResults(userId, { ...(results.readResults(userId) || {}), [summary.id]: summary });
  const { entries, categories, error } = await analyzeExamReportWeakConcepts(
    { text: reportText, lectures, objectives, blockId, blockName, report: summary },
    { callAIJSON: deps.callAIJSON || (await import("../../aiClient.js")).callAIJSON },
  );
  if (entries.length) {
    const store = results.readWeak(userId) || {};
    await results.writeWeak(userId, { ...store, [blockId]: mergeExamReportConcepts(store[blockId] || [], entries) });
  }
  // Link each weak category to its lectures, objectives and school questions.
  // A mapping failure keeps the import: the CBSE plan offers to map again.
  let targetError = null;
  if (entries.length) {
    const mapTargets = deps.mapReportTargets || (await import("./mapReportTargets.js")).mapReportTargets;
    try { await mapTargets({ userId, blockId }, { lectures, objectives, report: summary, ...(deps.mapDeps || {}) }); }
    catch (problem) { targetError = problem?.message || String(problem); }
  }
  const weakNames = new Set(entries.map(entry => entry.concept));
  return { summary, ...(targetError ? { targetError } : {}), weakCategories: categories.filter(category => weakNames.has(category.category)), categoryCount: categories.length, ...(error ? { categoryError: error } : {}) };
}

async function loadDefaults(deps) {
  if (deps.readResults && deps.writeResults && deps.readWeak && deps.writeWeak) return deps;
  const [schoolResults, weakConcepts] = await Promise.all([import("../../stores/schoolResults.js"), import("../../stores/weakConcepts.js")]);
  return {
    readResults: deps.readResults || schoolResults.read, writeResults: deps.writeResults || schoolResults.write,
    readWeak: deps.readWeak || weakConcepts.read, writeWeak: deps.writeWeak || (async (userId, value) => weakConcepts.write(userId, value)),
  };
}
