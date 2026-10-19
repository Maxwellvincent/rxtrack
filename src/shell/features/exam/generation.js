import { readSlot, questionSlot, objectiveSubject, bpmObjective } from "./bpmBlueprint.js";
import { waitForConnection } from "./preparationRecovery.js";
import { hasCurrentReasoningAudit } from "../../../engine/questionOrder.js";
import { readClinicalAnalysesForBlock, readExemplarsForBlock, resolveDefaultDifficulty, startObjectiveQuiz } from "../objectives/quizLaunch.js";
import { isSemanticDuplicate, questionFingerprint, schoolStyleSimilarity, questionQualityIssues } from "./questionQuality.js";
import { questionPoolKey, isValidPoolQuestion } from "../../../questionPool.js";
import { withDeadline } from "../../../asyncDeadline.js";
import { repairTaskForIndex } from "./focusedRepair.js";
import { canonicalObjectiveIds } from "../../../engine/objectiveLinks.js";
import { buildClinicalCorrelateLibrary } from "../../../engine/clinicalCorrelates.js";
import { questionMatchesObjectiveDomain } from "../../../engine/mcq.js";
import { fetchLectureContent } from "../../../supabase.js";
import { getLecText } from "../../../lectureText.js";
import { loadExamLectureEvidence } from "./lectureEvidence.js";

const MAX_ATTEMPTS = 3;
// Local Ollama completions for large, school-style prompts routinely take a little over
// two minutes on this Mac. Keep the outer deadline beyond the bridge deadline so a healthy
// local generation is not aborted and silently sent to paid cloud providers.
const REQUEST_TIMEOUT_MS = 360_000;
const LOCAL_BRIDGE_TIMEOUT_MS = 300_000;
export function alreadyUsed(q, history) {
  const stem = q.stem.toLowerCase().replace(/\s+/g, " ").trim();
  return history.some(h => {
    const previous = String(h.stem || "").toLowerCase().replace(/\s+/g, " ").trim();
    // Older calibration entries retain only the first 100 characters.
    return previous && (stem === previous || (previous.length >= 80 && stem.startsWith(previous)));
  }) || isSemanticDuplicate(q, history);
}

/** Keep provenance honest: a question may claim only supplied objective IDs.
 * If a lecture has one objective, an older generator response without tags can
 * be safely attributed to that sole target. With multiple objectives, leaving
 * it untagged is safer than claiming broad coverage. */
export function resolveQuestionObjectiveIds(question, objectives = []) {
  const ids = canonicalObjectiveIds(question?.objectiveIds || [], objectives);
  if (ids.length) return ids.slice(0, 1);
  return objectives.length === 1 && objectives[0]?.id ? [objectives[0].id] : [];
}

export function buildObjectiveCoverage(questions = [], objectives = []) {
  const counts = Object.fromEntries(objectives.map(o => [o.id, 0]));
  for (const question of questions) {
    for (const id of resolveQuestionObjectiveIds(question, objectives)) {
      if (id in counts) counts[id] += 1;
    }
  }
  const total = questions.length;
  return {
    counts,
    covered: objectives.filter(o => counts[o.id] > 0).map(o => o.id),
    untested: objectives.filter(o => counts[o.id] === 0).map(o => o.id),
    untagged: questions.filter(q => !resolveQuestionObjectiveIds(q, objectives).length).length,
    questionCount: total,
    coverageRate: objectives.length ? objectives.filter(o => counts[o.id] > 0).length / objectives.length : null,
  };
}

/** Two bounded workers, incremental cloud persistence, then atomic assignment
 * at launch. A prepared pool is not an answer history or a mastery claim. */
export async function generateExamQuestions({ allocation, lecturesById, objectivesByLecture, atomsByLecture,
  blockId, lectures, weakConceptAccuracyByLecture, userId, generationId, focusNotes = "", difficultyOverride = null, preparedGenerationId = null, preparedQuestionIds = [] }, deps = {}) {
  const questions = [], errors = [], accepted = [];
  const baseExemplars = readExemplarsForBlock(userId, blockId);
  const baseClinicalAnalyses = readClinicalAnalysesForBlock(userId, blockId);
  const lectureIds = Object.keys(allocation || {}).filter(id => allocation[id] > 0);
  const total = lectureIds.reduce((n, id) => n + allocation[id], 0);
  const history = deps.pool ? await deps.pool.history() : [];
  let nextIndex = 0, cacheHits = 0, stopError = null;
  let completedLectures = 0;
  const activities = new Map();
  const coverageByLecture = {};
  const progress = (message, lectureId = null) => {
    if (lectureId) activities.set(lectureId, message);
    deps.onProgress?.({ message, completed: questions.length, total, cacheHits,
      completedLectures, totalLectures: lectureIds.length, failedLectures: errors.length,
      activeLectures: [...activities.values()] });
  };

  async function generateLecture(allocationId) {
    const { lectureId, subject } = readSlot(allocationId);
    await waitForConnection();
    const requested = allocation[allocationId];
    const objectives = (objectivesByLecture?.[lectureId] || []).filter(o => !subject || (bpmObjective(o) && objectiveSubject(o) === subject));
    let atoms = atomsByLecture?.[lectureId] || [];
    let lecture = lecturesById?.[lectureId];
    const lectureTitle = lecture?.lectureTitle || lecture?.fileName || lectureId;
    let lectureText = getLecText(lecture);
    let sourceError = null;
    if (!deps.savedOnly) {
      progress(`Loading saved lecture content: ${lectureTitle}`, lectureId);
      try {
        const loaded = await withDeadline(() => loadExamLectureEvidence(lecture, atoms, {
          userId, fetchContent: deps.fetchLectureContent || fetchLectureContent,
        }), deps.contentTimeoutMs || 30000, deps.signal, "Loading saved lecture content");
        ({ lecture, lectureText, atoms } = loaded);
      } catch (error) {
        sourceError = error.message;
      }
    }
    const sourceBlockId = subject ? lecture?.blockId || blockId : blockId;
    const exemplars = sourceBlockId === blockId ? baseExemplars : readExemplarsForBlock(userId, sourceBlockId);
    const clinicalAnalyses = sourceBlockId === blockId ? baseClinicalAnalyses : readClinicalAnalysesForBlock(userId, sourceBlockId);
    const clinicalCorrelateLibrary = buildClinicalCorrelateLibrary({
      atoms,
      examples: exemplars,
      analyses: clinicalAnalyses,
      lecture,
      lectureTitle,
    });
    const difficulty = ["medium", "hard", "expert"].includes(difficultyOverride)
      ? difficultyOverride
      : resolveDefaultDifficulty(weakConceptAccuracyByLecture?.[lectureId]);
    const studyMode = objectives.some((objective) => objective.repairPriority > 0) ? "repair" : "balanced";
    const bucket = deps.pool ? await questionPoolKey({ blockId, lectureId, difficulty, lecture, objectives, atoms, exemplars, studyMode, clinicalCorrelateLibrary }) : null;
    let obtained = 0, attempt = 0, errorMessage = null;
    const enforceQuality = deps.skipQuestionAudit !== true;
    if (deps.pool) {
      progress(`Checking saved questions: ${lectureTitle}`);
      const savedQuestions = preparedGenerationId && deps.pool.readyForGeneration
        ? await deps.pool.readyForGeneration(preparedGenerationId, lectureId, preparedQuestionIds)
        : deps.savedOnly && !difficultyOverride && deps.pool.readyForLectures
        ? await deps.pool.readyForLectures([lectureId])
        : await deps.pool.ready(bucket);
      for (const q of savedQuestions) {
        if (obtained >= requested) break;
        const objectiveIds = resolveQuestionObjectiveIds(q, objectives);
        if (subject && !(q.objectiveIds || []).some(id=>objectives.some(o=>o.id===id || o.code===id))) continue;
        const cached = { ...q, objectiveIds, ...(subject ? { blueprintSlot: allocationId, blueprintSubject: subject, sourceBlockId } : {}) };
        if (enforceQuality && (!hasCurrentReasoningAudit(q) || alreadyUsed(q, [...history, ...accepted]) || questionQualityIssues(q, objectives).length || !questionMatchesObjectiveDomain(cached, { objectives, atoms }))) continue;
        accepted.push(cached); questions.push(cached); obtained++; cacheHits++;
        await deps.onQuestionReady?.(cached);
      }
      progress(`Loaded saved questions: ${lectureTitle}`);
    }
    if (sourceError) errorMessage = sourceError;
    while (obtained < requested && attempt < Math.max(MAX_ATTEMPTS, Math.ceil(requested / 3) + 2) && !stopError && !sourceError) {
      if (deps.savedOnly) break;
      await waitForConnection();
      attempt++;
      progress(`Writing questions: ${lectureTitle}${attempt > 1 ? ` · retry ${attempt - 1}` : ""}`, lectureId);
      let result;
      try {
        result = await withDeadline(signal => startObjectiveQuiz({ objectives, lectureTitle, lectureIdHint: lectureId, blockId, lectures, exemplars, atoms,
          lectureText,
          studyMode,
          focusNotes,
          difficulty, userId, clinicalCorrelateLibrary, avoidStems: [...history, ...accepted].map(q => q.stem).filter(Boolean).slice(-100), questionCount: Math.min(3, requested - obtained) }, {
          ...deps,
          maxTokens: Math.min(8000, Math.max(2000, Math.min(3, requested - obtained) * 1100)),
          callAIJSON: (...args) => {
            progress(`${/independent|audit/i.test(String(args[0])) ? "Reviewing accuracy" : "Writing questions"}: ${lectureTitle}`, lectureId);
            args[6] = { ...args[6], signal, bridgeTimeoutMs: LOCAL_BRIDGE_TIMEOUT_MS, throwOnError: true };
            return deps.callAIJSON(...args);
          },
        }), deps.requestTimeoutMs || REQUEST_TIMEOUT_MS);
      } catch (error) { result = { error: error.message, questions: [] }; }
      if (result?.error) {
        errorMessage = result.error;
        if (/timed out|deadline|quota|usage.limit|credit|exhaust|429|rate.limit|unavailable|network|403|401|permission/i.test(errorMessage)) stopError = errorMessage;
        break; // Transport failures are not question shortfalls: don't repeat them three times.
      }
      for (const q of result?.questions || []) {
        if (obtained >= requested) break;
        const objectiveIds = resolveQuestionObjectiveIds(q, objectives);
        if (subject && (!objectiveIds.length || (q.objectiveIds?.length && !q.objectiveIds.some(id=>objectives.some(o=>o.id===id || o.code===id))))) continue;
        const qualityIssues = questionQualityIssues(q, objectives);
        if (!isValidPoolQuestion(q) || (enforceQuality && (qualityIssues.length || !questionMatchesObjectiveDomain({ ...q, objectiveIds }, { objectives, atoms }) || alreadyUsed(q, [...history, ...accepted])))) continue;
        const stamped = { ...q, ...(subject ? { blueprintSlot: allocationId, blueprintSubject: subject, sourceBlockId } : {}), difficulty, questionId: crypto.randomUUID(), blockId, lectureId,
          taskType: studyMode === "repair" ? repairTaskForIndex(obtained) : (q.taskType || null),
          objectiveIds,
          fingerprint: questionFingerprint(q), schoolStyleScore: schoolStyleSimilarity(q, exemplars),
          source: exemplars.length ? "school-style generated" : "lecture generated" };
        // Reserve in this run before awaiting storage, preventing worker races.
        accepted.push(stamped);
        const saved = deps.pool ? await deps.pool.save(stamped, bucket, generationId) : stamped;
        if (!saved) continue;
        questions.push(saved); obtained++;
        await deps.onQuestionReady?.(saved);
        progress(`Saved ${questions.length}/${total} questions · ${cacheHits} from your prepared pool`);
      }
    }
    if (obtained < requested) errors.push({ lectureId: allocationId, requested, obtained,
      message: `${lectureTitle}: ${obtained}/${requested} questions ready. ${errorMessage || stopError || `Shortfall after ${attempt} attempts.`}` });
    coverageByLecture[allocationId] = buildObjectiveCoverage(
      questions.filter(q => questionSlot(q) === allocationId), objectives
    );
  }
  async function worker() {
    while (nextIndex < lectureIds.length) {
      const lectureId = lectureIds[nextIndex++];
      try { await generateLecture(lectureId); }
      finally {
        completedLectures++;
        activities.delete(readSlot(lectureId).lectureId);
        progress(`Checked ${completedLectures}/${lectureIds.length} lectures`);
      }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(2, lectureIds.length) }, worker));
  const failed = results.find(r => r.status === "rejected");
  if (failed) throw failed.reason;
  const blockObjectives = [...new Map(lectureIds.flatMap(id => { const {lectureId,subject}=readSlot(id); return (objectivesByLecture?.[lectureId] || []).filter(o=>!subject || (bpmObjective(o)&&objectiveSubject(o)===subject)); }).map(o=>[o.id,o])).values()];
  return {
    questions,
    errors,
    cacheHits,
    coverageByLecture,
    coverage: buildObjectiveCoverage(questions, blockObjectives),
  };
}
