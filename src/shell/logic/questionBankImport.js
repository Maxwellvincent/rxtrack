import { parseExamPDF } from "../../examParser.js";
import { callAIJSON } from "../../aiClient.js";
import * as questionBanksStore from "../../stores/questionBanks.js";
import * as questionBankMetaStore from "../../stores/questionBankMeta.js";
import * as weakConceptsStore from "../../stores/weakConcepts.js";
import { extractPairedAnswerKey, pairQuestionBankFiles, selectQuestionBankFiles, summarizeBankUpload, tagBankQuestions } from "./questionBankIngest.js";
import { analyzeExamReportWeakConcepts, mergeExamReportConcepts, parseExamReportSummary } from "./examReportWeakConcepts.js";
import { cleanLectureTitle } from "../../lectureTitle.js";
import { uploadQuestionBankPage } from "../../supabase.js";
import { buildQuestionBankAnalysis, buildQuestionBankCritiquePrompt, mergeQuestionBankCritique } from "./questionBankAnalysis.js";
import * as questionBankAnalysisStore from "../../stores/questionBankAnalysis.js";

function extractImcqBreakdownKeys(text) {
  return [...String(text || "").matchAll(/\b([A-H])\s*[✓✔]/g)].map((match) => match[1].toUpperCase());
}

function noop() {}

/**
 * Read, pair, persist, and analyze uploaded question banks without requiring
 * the importing modal to stay mounted. The caller owns the notification job.
 */
export async function processQuestionBankFiles({
  selectedFiles,
  blockId,
  blockName = "",
  lectures = [],
  objectives = [],
  userId = null,
  wrongOnly = false,
  sourceKind = "school",
  useLlm = false,
  schoolResultsData = {},
  schoolResultsLoading = false,
  schoolResultsError = null,
  schoolResultsMutate,
  update = noop,
  onUploaded,
}) {
  const files = selectQuestionBankFiles(selectedFiles);
  if (!files.length) return "No supported question-bank files found.";

  const report = { results: [], weakCategories: [], savedResults: [], pendingAnalyses: [] };
  let pendingBanks = { ...(questionBanksStore.read(userId) || {}) };
  let pendingMeta = { ...(questionBankMetaStore.read(userId) || {}) };
  let banksChanged = false;
  let currentSchoolResults = { ...(schoolResultsData || {}) };

  update(`0/${files.length} files queued · preparing answer-key pairs…`);

  const imcqSource = files.find((file) => /IMCQ.*KEY/i.test(file.name));
  const imcqBreakdown = files.find((file) => /IMCQ.*Answer.*Breakdown/i.test(file.name));
  const pairedFiles = pairQuestionBankFiles(files);
  const pairedAnswers = new Map();
  const pairedAnswerFiles = new Set();
  let imcqKeys = null;

  if (imcqSource && imcqBreakdown) {
    update(`Reading ${imcqBreakdown.name} for its answer key…`);
    const breakdown = await parseExamPDF(imcqBreakdown, undefined, { textOnly: true });
    imcqKeys = extractImcqBreakdownKeys(breakdown.fullText);
    if (imcqKeys.length !== 16) {
      throw new Error(`IMCQ answer breakdown contained ${imcqKeys.length} keyed answers; expected exactly 16.`);
    }
  }

  for (const { questionFile, answerFile } of pairedFiles) {
    update(`Reading paired answer key ${answerFile.name}…`);
    const answerDoc = await parseExamPDF(answerFile, undefined, { textOnly: true });
    const answerKey = extractPairedAnswerKey(answerDoc.fullText);
    if (answerKey.size < 3) {
      throw new Error(`${answerFile.name} did not contain at least three numbered letter answers.`);
    }
    pairedAnswers.set(questionFile, answerKey);
    pairedAnswerFiles.add(answerFile);
  }

  for (const [index, file] of files.entries()) {
    if (file === imcqBreakdown && imcqSource && imcqKeys) continue;
    if (pairedAnswerFiles.has(file)) continue;

    try {
      const bankTitle = cleanLectureTitle(file.name);
      const pairedKey = pairedAnswers.get(file);
      update(`${index + 1}/${files.length} · parsing ${file.name}…`);
      const parsed = await parseExamPDF(file, (message) => update(`${index + 1}/${files.length} · ${file.name} — ${message}`), {
        useLlm,
        forcePairedKey: file === imcqSource && imcqKeys,
        requireSourceKeys: !(file === imcqSource && imcqKeys || pairedKey),
      });

      if (pairedKey) {
        const parsedQuestions = parsed?.questions || [];
        const questionsByNumber = new Map(parsedQuestions.map((question, questionIndex) => [Number(question.num || questionIndex + 1), question]));
        const missing = [...pairedKey.keys()].filter((number) => !questionsByNumber.has(number));
        if (missing.length) {
          throw new Error(`${file.name} is missing keyed question number${missing.length === 1 ? "" : "s"} ${missing.join(", ")}. The pair was not imported.`);
        }
        parsed.questions = [...pairedKey.entries()].map(([number, answer]) => {
          const question = questionsByNumber.get(number);
          return { ...question, correct: answer.correct, explanation: answer.explanation || question.explanation || null };
        });
        parsed.expectedQuestions = parsed.questions.length;
      }

      if (file === imcqSource && imcqKeys) {
        const sourceQuestions = parsed?.questions || [];
        if (sourceQuestions.length !== imcqKeys.length) {
          throw new Error(`IMCQ source contained ${sourceQuestions.length} questions; expected ${imcqKeys.length} to match the supplied breakdown.`);
        }
        parsed.questions = sourceQuestions.map((question, questionIndex) => ({ ...question, correct: imcqKeys[questionIndex] }));
      }

      const pageUrls = new Map();
      const withDurableImages = [];
      for (const question of parsed?.questions || []) {
        let sourceImageUrl = question.sourceImageUrl || null;
        if (question.sourceImageDataUrl && question.sourcePage && userId) {
          if (!pageUrls.has(question.sourcePage)) {
            update(`${index + 1}/${files.length} · saving figure from ${file.name}, page ${question.sourcePage}…`);
            pageUrls.set(question.sourcePage, await uploadQuestionBankPage(userId, bankTitle, question.sourcePage, question.sourceImageDataUrl));
          }
          sourceImageUrl = pageUrls.get(question.sourcePage);
        }
        const { sourceImageDataUrl: _sourceImageDataUrl, ...storedQuestion } = question;
        withDurableImages.push({ ...storedQuestion, ...(sourceImageUrl ? { sourceImageUrl } : {}) });
      }

      const questions = tagBankQuestions(withDurableImages, { blockId, filename: bankTitle, wrongOnly, sourceKind });
      if (questions.length) {
        pendingBanks = Object.fromEntries(Object.entries(pendingBanks).filter(([filename]) => cleanLectureTitle(filename) !== bankTitle));
        pendingBanks[bankTitle] = questions;
        pendingMeta = Object.fromEntries(Object.entries(pendingMeta).filter(([, entry]) => cleanLectureTitle(entry?.filename) !== bankTitle));
        const analysis = buildQuestionBankAnalysis({
          questions,
          objectives,
          lectures,
          sourceKind,
          filename: bankTitle,
          expectedQuestions: parsed.expectedQuestions,
          extractionMethod: "exam-parser",
        });
        report.pendingAnalyses.push({ filename: bankTitle, questions, analysis });
        pendingMeta = questionBankMetaStore.withRecordedUpload(pendingMeta, {
          filename: bankTitle,
          blockId,
          sourceKind,
          expectedQuestions: parsed.expectedQuestions,
          extractionMethod: "exam-parser",
          analysisStatus: "ready",
        });
        banksChanged = true;
      }

      const reportResult = parseExamReportSummary(parsed?.fullText, { blockId });
      if (reportResult && userId) {
        if (schoolResultsLoading || schoolResultsError) {
          throw new Error("School-result history is not ready to merge safely. Reopen the uploader after it finishes syncing, then retry.");
        }
        currentSchoolResults = { ...currentSchoolResults, [reportResult.id]: reportResult };
        if (!schoolResultsMutate) throw new Error("School-result history is unavailable for this import.");
        await schoolResultsMutate(currentSchoolResults);
        report.savedResults.push(reportResult);
      }

      if (blockId && userId) {
        update(`${index + 1}/${files.length} · checking ${file.name} for score-report weaknesses…`);
        const { entries, categories } = await analyzeExamReportWeakConcepts(
          { text: parsed?.fullText, lectures, blockId, blockName },
          { callAIJSON }
        );
        if (entries.length) {
          const store = weakConceptsStore.read(userId) || {};
          const merged = mergeExamReportConcepts(store[blockId] || [], entries);
          weakConceptsStore.write(userId, { ...store, [blockId]: merged });
          report.weakCategories.push(...categories.filter((category) => entries.some((entry) => entry.concept === category.category)));
        }
      }

      report.results.push({ filename: bankTitle, questions, report: !!reportResult });
    } catch (error) {
      report.results.push({ filename: file.name, error: error?.message || String(error) });
    }
  }

  if (banksChanged) {
    update("Saving imported question banks and answer-key metadata…");
    await Promise.all([
      questionBanksStore.writeAwait(userId, pendingBanks),
      questionBankMetaStore.writeAwait(userId, pendingMeta),
      ...report.pendingAnalyses.map(({ filename, analysis }) => questionBankAnalysisStore.writeAwait(userId, filename, analysis)),
    ]);
    onUploaded?.();
  }

  let critiqueFailures = 0;
  for (const [index, entry] of report.pendingAnalyses.entries()) {
    update(`Analyzing ${index + 1}/${report.pendingAnalyses.length} · ${entry.filename}`);
    try {
      const reviewed = await callAIJSON(
        "You are a strict medical education reviewer. Preserve uploaded answer keys and clearly label uncertainty.",
        buildQuestionBankCritiquePrompt(entry.analysis, entry.questions, objectives, lectures),
        { items: [] },
        7000
      );
      const merged = mergeQuestionBankCritique(entry.analysis, reviewed);
      await questionBankAnalysisStore.writeAwait(userId, entry.filename, merged);
    } catch {
      critiqueFailures += 1;
    }
  }

  const summary = summarizeBankUpload(report.results);
  if (!summary.saved && !summary.empty.length) {
    throw new Error(summary.failed.join("; ") || "No question banks could be imported.");
  }
  const critiqueDetail = report.pendingAnalyses.length
    ? ` · ${report.pendingAnalyses.length - critiqueFailures}/${report.pendingAnalyses.length} analyses ready`
    : "";
  const reportDetail = report.savedResults.length ? ` · ${report.savedResults.length} score report${report.savedResults.length === 1 ? "" : "s"} saved` : "";
  const failureDetail = summary.failed.length ? ` · ${summary.failed.length} failed` : "";
  return `${summary.saved} bank${summary.saved === 1 ? "" : "s"} imported · ${summary.questions} questions${reportDetail}${critiqueDetail}${failureDetail}`;
}
