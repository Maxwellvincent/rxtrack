export const OBJECTIVE_MIN_ATTEMPTS = 3;
export const OBJECTIVE_MIN_ACCURACY = 0.8;
export const OBJECTIVE_MIN_SESSIONS = 2;
export const OBJECTIVE_MIN_TASK_TYPES = 2;

const countKeys = (value) => Object.keys(value || {}).filter((key) => (value[key] || 0) > 0).length;

function normalizedEvidence(objective, entry) {
  const evidenceAttempts = Math.max(0, Number(entry?.attempts) || 0);
  const useEvidence = evidenceAttempts > 0;
  const attempts = useEvidence
    ? evidenceAttempts
    : Math.max(0, Number(objective?.attempts ?? objective?.totalAttempts) || 0);
  const correct = Math.min(
    attempts,
    Math.max(0, useEvidence ? Number(entry?.correct) || 0 : Number(objective?.correctCount) || 0)
  );
  const recent = Array.isArray(entry?.recent) ? entry.recent : [];
  const latestCorrect = recent.length
    ? recent[recent.length - 1] === true
    : (Number(objective?.consecutiveCorrect) || 0) > 0;

  return {
    attempts,
    correct,
    latestCorrect,
    sessionCount: useEvidence ? (entry?.sessions || []).length : 0,
    taskTypeCount: useEvidence ? countKeys(entry?.taskTypes) : 0,
    sources: useEvidence ? entry?.sources || {} : {},
  };
}

/**
 * Smallest number of additional correct, varied questions that could satisfy
 * the readiness floor. It is deliberately a minimum: wrong answers, repeating
 * one task type, or doing everything in one sitting can increase the real work.
 */
export function minimumQuestionsToObjectiveReadiness(progress = {}) {
  const attempts = Math.max(0, Number(progress.attempts) || 0);
  const correct = Math.min(attempts, Math.max(0, Number(progress.correct) || 0));
  const needsSession = (Number(progress.sessionCount) || 0) < OBJECTIVE_MIN_SESSIONS;
  const needsTaskType = (Number(progress.taskTypeCount) || 0) < OBJECTIVE_MIN_TASK_TYPES;
  const needsLatestCorrect = attempts > 0 && !progress.latestCorrect;

  for (let additional = 0; additional < 1000; additional += 1) {
    const nextAttempts = attempts + additional;
    const nextCorrect = correct + additional;
    const enoughAnswers = nextAttempts >= OBJECTIVE_MIN_ATTEMPTS;
    const enoughAccuracy = nextAttempts > 0 && nextCorrect / nextAttempts >= OBJECTIVE_MIN_ACCURACY;
    const canAddMissingVariety = additional > 0 || (!needsSession && !needsTaskType && !needsLatestCorrect);
    if (enoughAnswers && enoughAccuracy && canAddMissingVariety) return additional;
  }
  return 1000;
}

export function objectivePracticePlan(objectives = [], evidenceModel = {}) {
  const rows = (objectives || []).filter((objective) => objective?.id).map((objective, index) => {
    const progress = normalizedEvidence(objective, evidenceModel?.objectives?.[objective.id]);
    const remaining = minimumQuestionsToObjectiveReadiness(progress);
    const accuracy = progress.attempts ? progress.correct / progress.attempts : null;
    const ready = remaining === 0;
    const worked = progress.attempts > 0 || ![null, undefined, "", "untested"].includes(objective.status);
    const struggling = progress.attempts >= 2 && accuracy < 0.6;
    return {
      ...progress,
      id: objective.id,
      code: objective.code || objective.objectiveCode || `Objective ${index + 1}`,
      text: objective.objective || objective.text || objective.title || "",
      accuracy,
      remaining,
      ready,
      worked,
      state: ready ? "ready" : struggling ? "struggling" : worked ? "developing" : "untested",
    };
  });

  return {
    rows,
    worked: rows.filter((row) => row.worked).length,
    ready: rows.filter((row) => row.ready).length,
    developing: rows.filter((row) => row.state === "developing").length,
    struggling: rows.filter((row) => row.state === "struggling").length,
    untested: rows.filter((row) => row.state === "untested").length,
    minimumRemaining: rows.reduce((sum, row) => sum + row.remaining, 0),
  };
}
