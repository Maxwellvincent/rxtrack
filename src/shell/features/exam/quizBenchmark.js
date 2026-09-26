const DATA_CUE = /\b(?:laboratory|lab results?|serum|plasma|urine|concentration|reference range|graph|chart|table|ECG|radiograph|ultrasound|CT scan|shown by the arrow|attached image)\b/i;

function questionSetMetrics(questions = []) {
  const optionCounts = {};
  for (const question of questions) {
    const count = Object.keys(question?.choices || {}).length;
    if (count) optionCounts[count] = (optionCounts[count] || 0) + 1;
  }
  return {
    count: questions.length,
    optionCounts,
    dataCueCount: questions.filter((question) => DATA_CUE.test(`${question?.stem || ""} ${question?.topic || ""}`)).length,
    visualCount: questions.filter((question) => question?.hasImage || question?.sourceImageUrl || question?.image?.url).length,
  };
}

function objectiveStats(items, correctByQuestionId) {
  const stats = {};
  for (const item of items || []) {
    const correct = correctByQuestionId.get(String(item.id || `q${item.num}`));
    if (typeof correct !== "boolean") continue;
    for (const id of item.objectiveIds || []) {
      const stat = stats[id] || { attempts: 0, correct: 0 };
      stat.attempts += 1;
      stat.correct += correct ? 1 : 0;
      stats[id] = stat;
    }
  }
  return stats;
}

/** Compare a report bank to the most recent submitted generated quiz without treating different forms as equivalent exams. */
export function buildQuizBenchmark(bank, session, objectives = []) {
  if (!bank?.questions?.length || !session?.questions?.length) return null;
  const answers = new Map((session.answers || []).map((answer) => [String(answer.questionId), answer.value]));
  const answeredQuestions = session.questions.filter((question) => answers.has(String(question.questionId)));
  const appCorrectById = new Map(answeredQuestions.map((question) => [String(question.questionId), answers.get(String(question.questionId)) === question.correct]));
  const sourceCorrectById = new Map((bank.questions || []).filter((question) => typeof question.sourceAttemptCorrect === "boolean")
    .map((question, index) => [String(question.id || `q${question.num || index + 1}`), question.sourceAttemptCorrect]));
  const sourceItems = bank.analysis?.items || [];
  const sourceObjectiveStats = objectiveStats(sourceItems, sourceCorrectById);
  const appObjectiveStats = objectiveStats(session.questions.map((question) => ({ id: question.questionId, objectiveIds: question.objectiveIds || [] })), appCorrectById);
  const objectiveById = new Map((objectives || []).map((objective) => [String(objective.id), objective]));
  const sharedObjectives = Object.keys(sourceObjectiveStats).filter((id) => appObjectiveStats[id]).map((id) => ({
    id,
    label: objectiveById.get(id)?.objective || objectiveById.get(id)?.text || objectiveById.get(id)?.code || id,
    source: sourceObjectiveStats[id],
    app: appObjectiveStats[id],
  })).sort((a, b) => (a.app.correct / a.app.attempts) - (b.app.correct / b.app.attempts));
  const sourcePerformance = bank.analysis?.sourcePerformance || null;
  const sourceMetrics = questionSetMetrics(bank.questions);
  const appMetrics = questionSetMetrics(session.questions);
  const appCorrect = answeredQuestions.filter((question) => appCorrectById.get(String(question.questionId))).length;
  return {
    bankTitle: bank.filename,
    sessionTitle: session.title || "Generated quiz",
    sourcePerformance,
    appPerformance: { correct: appCorrect, count: answeredQuestions.length, accuracy: answeredQuestions.length ? Math.round(appCorrect / answeredQuestions.length * 100) : null },
    sourceMetrics,
    appMetrics,
    sharedObjectives,
    objectiveCrosswalkBasis: sourceItems.find((item) => item.objectiveBasis)?.objectiveBasis || "unmapped",
  };
}

export function formatOptionMix(optionCounts = {}) {
  return Object.entries(optionCounts).sort(([a], [b]) => Number(a) - Number(b)).map(([count, total]) => `${count} options: ${total}`).join(" · ") || "not available";
}
