import { readClinicalAnalysesForBlock, readExemplarsForBlock, resolveDefaultDifficulty, startObjectiveQuiz } from "../objectives/quizLaunch.js";
import { isSemanticDuplicate, questionFingerprint, schoolStyleSimilarity, questionQualityIssues } from "./questionQuality.js";
import { questionPoolKey, isValidPoolQuestion } from "../../../questionPool.js";
import { withDeadline } from "../../../asyncDeadline.js";
import { repairTaskForIndex } from "./focusedRepair.js";
import { canonicalObjectiveIds } from "../../../engine/objectiveLinks.js";
import { buildClinicalCorrelateLibrary } from "../../../engine/clinicalCorrelates.js";

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
  blockId, lectures, weakConceptAccuracyByLecture, userId, generationId }, deps = {}) {
  const questions = [], errors = [], accepted = [];
  const exemplars = readExemplarsForBlock(userId, blockId);
  const clinicalCorrelateLibrary = buildClinicalCorrelateLibrary({
    atoms: Object.values(atomsByLecture || {}).flat(),
    examples: exemplars,
    analyses: readClinicalAnalysesForBlock(userId, blockId),
    // Supplying the lecture-wide library makes a block exam share recurring signals across
    // lectures while retaining the analyzed homework evidence for this block.
  });
  const lectureIds = Object.keys(allocation || {}).filter(id => allocation[id] > 0);
  const total = lectureIds.reduce((n, id) => n + allocation[id], 0);
  const history = deps.pool ? await deps.pool.history() : [];
  let nextIndex = 0, cacheHits = 0, stopError = null;
  const coverageByLecture = {};
  const progress = message => deps.onProgress?.({ message, completed: questions.length, total, cacheHits });

  async function generateLecture(lectureId) {
    const requested = allocation[lectureId];
    const objectives = objectivesByLecture?.[lectureId] || [];
    const atoms = atomsByLecture?.[lectureId] || [];
    const lecture = lecturesById?.[lectureId];
    const lectureTitle = lecture?.lectureTitle || lecture?.fileName || lectureId;
    const difficulty = resolveDefaultDifficulty(weakConceptAccuracyByLecture?.[lectureId]);
    const studyMode = objectives.some((objective) => objective.repairPriority > 0) ? "repair" : "balanced";
    const bucket = deps.pool ? await questionPoolKey({ blockId, lectureId, difficulty, lecture, objectives, atoms, exemplars, studyMode }) : null;
    let obtained = 0, attempt = 0, errorMessage = null;
    if (deps.pool) {
      progress(`Checking saved questions: ${lectureTitle}`);
      for (const q of await deps.pool.ready(bucket)) {
        if (obtained >= requested) break;
        if (alreadyUsed(q, [...history, ...accepted]) || questionQualityIssues(q, objectives).length) continue;
        const cached = { ...q, objectiveIds: resolveQuestionObjectiveIds(q, objectives) };
        accepted.push(cached); questions.push(cached); obtained++; cacheHits++;
      }
      progress(`Loaded saved questions: ${lectureTitle}`);
    }
    while (obtained < requested && attempt < MAX_ATTEMPTS && !stopError) {
      if (deps.savedOnly) break;
      attempt++;
      progress(`Generating: ${lectureTitle}${attempt > 1 ? ` · retry ${attempt - 1}` : ""} · up to 2 lectures at once`);
      let result;
      try {
        result = await withDeadline(signal => startObjectiveQuiz({ objectives, lectureTitle, blockId, lectures, exemplars, atoms,
          studyMode,
          difficulty, userId, clinicalCorrelateLibrary, avoidStems: [...history, ...accepted].map(q => q.stem).filter(Boolean).slice(-100), questionCount: requested - obtained }, {
          ...deps,
          maxTokens: Math.min(8000, Math.max(2000, (requested - obtained) * 1100)),
          callAIJSON: (...args) => {
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
        const qualityIssues = questionQualityIssues(q, objectives);
        if (!isValidPoolQuestion(q) || qualityIssues.length || alreadyUsed(q, [...history, ...accepted])) continue;
        const stamped = { ...q, difficulty, questionId: crypto.randomUUID(), blockId, lectureId,
          taskType: studyMode === "repair" ? repairTaskForIndex(obtained) : (q.taskType || null),
          objectiveIds: resolveQuestionObjectiveIds(q, objectives),
          fingerprint: questionFingerprint(q), schoolStyleScore: schoolStyleSimilarity(q, exemplars),
          source: exemplars.length ? "school-style generated" : "lecture generated" };
        // Reserve in this run before awaiting storage, preventing worker races.
        accepted.push(stamped);
        const saved = deps.pool ? await deps.pool.save(stamped, bucket, generationId) : stamped;
        if (!saved) continue;
        questions.push(saved); obtained++;
        progress(`Saved ${questions.length}/${total} questions · ${cacheHits} from your prepared pool`);
      }
    }
    if (obtained < requested) errors.push({ lectureId, requested, obtained,
      message: `${lectureTitle}: ${obtained}/${requested} questions ready. ${errorMessage || stopError || `Shortfall after ${attempt} attempts.`}` });
    coverageByLecture[lectureId] = buildObjectiveCoverage(
      questions.filter(q => q.lectureId === lectureId), objectives
    );
  }
  async function worker() {
    while (nextIndex < lectureIds.length) {
      const lectureId = lectureIds[nextIndex++];
      await generateLecture(lectureId);
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(2, lectureIds.length) }, worker));
  const failed = results.find(r => r.status === "rejected");
  if (failed) throw failed.reason;
  const blockObjectives = lectureIds.flatMap(id => objectivesByLecture?.[id] || []);
  return {
    questions,
    errors,
    cacheHits,
    coverageByLecture,
    coverage: buildObjectiveCoverage(questions, blockObjectives),
  };
}
