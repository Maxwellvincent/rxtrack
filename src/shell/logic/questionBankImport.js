import { parseExamPDF } from "../../examParser.js";
import { callAIJSON, callAIWithImage } from "../../aiClient.js";
import { tryParseJSON } from "../../lib/aiJson.js";
import * as questionBanksStore from "../../stores/questionBanks.js";
import * as questionBankMetaStore from "../../stores/questionBankMeta.js";
import * as weakConceptsStore from "../../stores/weakConcepts.js";
import { extractPairedAnswerKey, isQuestionBankImage, pairQuestionBankFiles, selectQuestionBankFiles, summarizeBankUpload, tagBankQuestions } from "./questionBankIngest.js";
import { analyzeExamReportWeakConcepts, mergeExamReportConcepts, parseExamReportSummary } from "./examReportWeakConcepts.js";
import { cleanLectureTitle } from "../../lectureTitle.js";
import { uploadQuestionBankPage } from "../../supabase.js";
import { buildQuestionBankAnalysis, buildQuestionBankCritiquePrompt, mergeQuestionBankCritique } from "./questionBankAnalysis.js";
import * as questionBankAnalysisStore from "../../stores/questionBankAnalysis.js";

function extractImcqBreakdownKeys(text) {
  return [...String(text || "").matchAll(/\b([A-H])\s*[✓✔]/g)].map((match) => match[1].toUpperCase());
}

function noop() {}

const CLICKER_IMAGE_PROMPT = `You are extracting one photographed medical-school in-class clicker slide.
Use only text and visual markings that are actually visible in the image. Do not complete a cropped
question from outside knowledge. Return ONLY valid JSON with this shape:
{"isQuestion":true,"questionNumber":null,"stem":"","choices":{"A":"","B":"","C":"","D":"","E":""},"correct":null,"answerKeyVerified":false,"answerKeyEvidence":"","explanation":"","hasImage":false,"imageDependent":false}

Rules:
- Set isQuestion false when the image is only a continuation, answer-only slide, lecture slide, or does not show a complete stem and at least two answer choices.
- Transcribe the complete visible stem and every visible choice. Preserve arrows, units, labels, and table-like wording.
- Set answerKeyVerified true and correct to a letter ONLY when a visible highlight, check, selected response, or other unambiguous marking identifies the answer. A clinically plausible answer is not a source key. Otherwise correct must be null and answerKeyVerified false.
- If an answer is visibly marked, describe the exact visual evidence briefly in answerKeyEvidence; never infer a key from the stem.
- Set hasImage and imageDependent true when the question refers to a figure, labeled structure, radiograph, histology, graph, table, or other visual needed to answer it. The original image will be retained with the question.
- Do not invent an explanation. Use an explanation only when it is visibly printed on the slide.
`;

function imageMimeType(file) {
  if (file?.type) return file.type;
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function fileAsImagePayload(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  const mimeType = imageMimeType(file);
  return { base64, dataUrl: `data:${mimeType};base64,${base64}`, mimeType };
}

function normalizeClickerQuestion(raw, file, index, imagePayload) {
  const choices = Object.fromEntries(
    Object.entries(raw?.choices || {})
      .map(([letter, value]) => [String(letter).toUpperCase(), String(value ?? "").trim()])
      .filter(([letter, value]) => /^[A-H]$/.test(letter) && value)
  );
  const stem = String(raw?.stem || "").replace(/\s+/g, " ").trim();
  const markedCorrect = String(raw?.correct || "").trim().toUpperCase();
  const answerKeyVerified = raw?.answerKeyVerified === true && /^[A-H]$/.test(markedCorrect) && !!choices[markedCorrect];
  if (!raw?.isQuestion || !stem || Object.keys(choices).length < 2) return null;
  return {
    num: Number(raw?.questionNumber) || index + 1,
    stem,
    choices,
    correct: answerKeyVerified ? markedCorrect : null,
    answerKeyVerified,
    sourceKeyStatus: answerKeyVerified ? "present" : "missing",
    answerKeyEvidence: answerKeyVerified ? String(raw?.answerKeyEvidence || "").trim() : "",
    explanation: String(raw?.explanation || "").trim() || null,
    hasImage: raw?.hasImage === true || raw?.imageDependent === true,
    imageDependent: raw?.imageDependent === true,
    sourceImageDataUrl: imagePayload.dataUrl,
    sourcePage: index + 1,
    sourceImageMimeType: imagePayload.mimeType,
  };
}

/** Parse photographed clicker slides without routing JPEGs through the PDF parser. */
export async function parseClickerImage(file, index = 0, deps = {}) {
  const imagePayload = await fileAsImagePayload(file);
  const rawText = await (deps.callAIWithImage || callAIWithImage)(
    CLICKER_IMAGE_PROMPT,
    `Extract the clicker question from ${file?.name || "this image"}. If the slide is cropped or incomplete, return isQuestion false.`,
    imagePayload.base64,
    imagePayload.mimeType,
    2200,
    0.1,
  );
  const parsed = tryParseJSON(rawText) || {};
  return normalizeClickerQuestion(parsed, file, index, imagePayload);
}

export function questionBankTitleForImages(files = []) {
  const relative = String(files.find((file) => file?.webkitRelativePath)?.webkitRelativePath || "");
  const parts = relative.split("/").filter(Boolean);
  if (parts.length > 1) return cleanLectureTitle(parts.at(-2)) || "In-class Clicker Examples";
  return "In-class Clicker Examples";
}

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

  const imageFiles = files.filter(isQuestionBankImage);
  if (imageFiles.length) {
    if (sourceKind !== "clicker") {
      throw new Error("Image question banks must be imported with the In-class clicker images source type so they remain example-only until keyed.");
    }
    const bankTitle = questionBankTitleForImages(imageFiles);
    const parsedQuestions = [];
    let skippedImages = 0;
    for (const [imageIndex, file] of imageFiles.entries()) {
      update(`${imageIndex + 1}/${files.length} · reading clicker image ${file.name}…`);
      try {
        const question = await parseClickerImage(file, imageIndex);
        if (question) parsedQuestions.push(question);
        else skippedImages += 1;
      } catch (error) {
        report.results.push({ filename: file.name, error: error?.message || String(error) });
      }
    }

    // A photographed lecture slide may be duplicated as a phone screenshot or
    // followed by a continuation slide. Keep one complete stem per source set.
    const uniqueQuestions = [...new Map(parsedQuestions.map((question) => [
      question.stem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      question,
    ])).values()];
    const withDurableImages = [];
    for (const question of uniqueQuestions) {
      let sourceImageUrl = null;
      if (question.sourceImageDataUrl && userId) {
        update(`Saving original clicker image ${question.sourcePage}/${uniqueQuestions.length}…`);
        sourceImageUrl = await uploadQuestionBankPage(userId, bankTitle, question.sourcePage, question.sourceImageDataUrl);
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
        expectedQuestions: null,
        extractionMethod: "vision-clicker-images",
      });
      report.pendingAnalyses.push({ filename: bankTitle, questions, analysis });
      pendingMeta = questionBankMetaStore.withRecordedUpload(pendingMeta, {
        filename: bankTitle,
        blockId,
        sourceKind,
        expectedQuestions: null,
        extractionMethod: "vision-clicker-images",
        analysisStatus: "ready",
      });
      banksChanged = true;
    }
    report.results.push({ filename: bankTitle, questions, skippedImages, report: false });
  }

  for (const [index, file] of files.entries()) {
    if (isQuestionBankImage(file)) continue;
    if (file === imcqBreakdown && imcqSource && imcqKeys) continue;
    if (pairedAnswerFiles.has(file)) continue;

    try {
      const bankTitle = cleanLectureTitle(file.name);
      const pairedKey = pairedAnswers.get(file);
      update(`${index + 1}/${files.length} · parsing ${file.name}…`);
      let parsed = await parseExamPDF(file, (message) => update(`${index + 1}/${files.length} · ${file.name} — ${message}`), {
        useLlm,
        forcePairedKey: file === imcqSource && imcqKeys,
        requireSourceKeys: !(file === imcqSource && imcqKeys || pairedKey),
      });

      // Some IMCQ PDFs contain repeated question/key slides. The paired-slide
      // parser can count a duplicated continuation as an extra item even when
      // the supplied breakdown has the authoritative 16-question count. Retry
      // the deterministic text path and accept it only when it matches exactly;
      // otherwise preserve the fail-closed behavior.
      if (file === imcqSource && imcqKeys && parsed.questions.length !== imcqKeys.length) {
        update(`${index + 1}/${files.length} · IMCQ count mismatch; retrying the numbered source path…`);
        const retry = await parseExamPDF(file, undefined, {
          useLlm: false,
          forcePairedKey: false,
          requireSourceKeys: true,
        });
        if (retry.questions.length === imcqKeys.length) parsed = retry;
      }

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
