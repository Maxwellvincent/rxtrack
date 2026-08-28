import { readExemplarsForBlock, resolveDefaultDifficulty, startObjectiveQuiz } from "../objectives/quizLaunch.js";
import { isSemanticDuplicate, questionFingerprint, schoolStyleSimilarity } from "./questionQuality.js";
import { questionPoolKey, isValidPoolQuestion } from "../../../questionPool.js";
import { withDeadline } from "../../../asyncDeadline.js";

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 180_000;
export function alreadyUsed(q, history) {
  const stem = q.stem.toLowerCase().replace(/\s+/g, " ").trim();
  return history.some(h => {
    const previous = String(h.stem || "").toLowerCase().replace(/\s+/g, " ").trim();
    // Older calibration entries retain only the first 100 characters.
    return previous && (stem === previous || (previous.length >= 80 && stem.startsWith(previous)));
  }) || isSemanticDuplicate(q, history);
}

/** Two bounded workers, incremental cloud persistence, then atomic assignment
 * at launch. A prepared pool is not an answer history or a mastery claim. */
export async function generateExamQuestions({ allocation, lecturesById, objectivesByLecture, atomsByLecture,
  blockId, lectures, weakConceptAccuracyByLecture, userId, generationId }, deps = {}) {
  const questions = [], errors = [], accepted = [];
  const exemplars = readExemplarsForBlock(userId, blockId);
  const lectureIds = Object.keys(allocation || {}).filter(id => allocation[id] > 0);
  const total = lectureIds.reduce((n, id) => n + allocation[id], 0);
  const history = deps.pool ? await deps.pool.history() : [];
  let nextIndex = 0, cacheHits = 0, stopError = null;
  const progress = message => deps.onProgress?.({ message, completed: questions.length, total, cacheHits });

  async function generateLecture(lectureId) {
    const requested = allocation[lectureId];
    const objectives = objectivesByLecture?.[lectureId] || [];
    const atoms = atomsByLecture?.[lectureId] || [];
    const lecture = lecturesById?.[lectureId];
    const lectureTitle = lecture?.lectureTitle || lecture?.fileName || lectureId;
    const difficulty = resolveDefaultDifficulty(weakConceptAccuracyByLecture?.[lectureId]);
    const objectiveIds = objectives.map(o => o?.id).filter(Boolean);
    const bucket = deps.pool ? await questionPoolKey({ blockId, lectureId, difficulty, lecture, objectives, atoms, exemplars }) : null;
    let obtained = 0, attempt = 0, errorMessage = null;
    if (deps.pool) {
      progress(`Checking saved questions: ${lectureTitle}`);
      for (const q of await deps.pool.ready(bucket)) {
        if (obtained >= requested) break;
        if (alreadyUsed(q, [...history, ...accepted])) continue;
        accepted.push(q); questions.push(q); obtained++; cacheHits++;
      }
      progress(`Loaded saved questions: ${lectureTitle}`);
    }
    while (obtained < requested && attempt < MAX_ATTEMPTS && !stopError) {
      attempt++;
      progress(`Generating: ${lectureTitle}${attempt > 1 ? ` · retry ${attempt - 1}` : ""} · up to 2 lectures at once`);
      let result;
      try {
        result = await withDeadline(signal => startObjectiveQuiz({ objectives, lectureTitle, blockId, lectures, exemplars, atoms,
          difficulty, userId, avoidStems: [...history, ...accepted].map(q => q.stem).filter(Boolean).slice(-100), questionCount: requested - obtained }, {
          ...deps,
          maxTokens: Math.min(8000, Math.max(2000, (requested - obtained) * 1100)),
          callAIJSON: (...args) => {
            args[6] = { ...args[6], signal, bridgeTimeoutMs: 90_000, throwOnError: true };
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
        if (!isValidPoolQuestion(q) || alreadyUsed(q, [...history, ...accepted])) continue;
        const stamped = { ...q, difficulty, questionId: crypto.randomUUID(), blockId, lectureId,
          objectiveIds: q.objectiveIds?.length ? q.objectiveIds : objectiveIds,
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
  return { questions, errors, cacheHits };
}
