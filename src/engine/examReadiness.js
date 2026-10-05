export const MASTERY_STAGES = [
  "exposure",
  "recognition",
  "recall",
  "mechanism",
  "application",
  "discrimination",
  "stable",
];

export const ERROR_TAXONOMY = {
  K: "Knowledge",
  C: "Concept",
  M: "Mechanism",
  R: "Reasoning",
  Q: "Question language",
  D: "Discrimination",
  A: "Attention",
  E: "Endurance",
};

export const BPM2_DM_BENCHMARK = {
  id: "benchmark-1-bpm2-dm-2026-09-30",
  benchmarkNumber: 1,
  name: "BPM2 DM exam",
  date: "2026-09-30",
  kind: "exam",
  blockId: "bpm2-dm",
  actualPercent: 65.38,
  targetPercent: 80,
  source: "post-exam baseline",
  categories: {
    "Physiology": 78.57,
    "Histology & Cell Biology": 76.92,
    "Gross Anatomy & Embryology": 71.43,
    "Biochemistry": 59.76,
    "Nutrition": 54.05,
    "GI overall": 73.53,
    "Energy metabolism": 55.56,
    "Genetic metabolic/developmental disorders": 53.33,
    "Vitamins deficiencies/toxicities": 33.33,
  },
};

const STAGE_TASKS = {
  recognition: new Set(["recognition", "state-recognition", "diagnosis", "build-recognition"]),
  recall: new Set(["recall", "grounded-recall", "build-recall"]),
  mechanism: new Set(["mechanism", "pathway-process", "enzyme-pathway", "build-mechanism"]),
  application: new Set(["application", "clinical-application", "decision", "break-application"]),
  discrimination: new Set(["discrimination", "relationship", "closest-mimic", "break-discrimination"]),
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ratio = (correct, attempts) => attempts > 0 ? correct / attempts : null;
const day = 86_400_000;

export function answerQuality({ correct, confidence, assisted = false, reasoningCorrect = null } = {}) {
  if (!correct) return 0;
  if (reasoningCorrect === false || confidence === "guess") return 1;
  if (assisted || confidence === "unsure" || confidence == null) return 2;
  return 3;
}

export function masteryStageForTask(taskType, reasoningDepth = null) {
  const values = [taskType, reasoningDepth].map((value) => String(value || "").toLowerCase());
  for (const stage of ["discrimination", "application", "mechanism", "recall", "recognition"]) {
    if (values.some((value) => STAGE_TASKS[stage].has(value))) return stage;
  }
  return "recognition";
}

export function computeSecondStepAccuracy(events = []) {
  const eligible = events.filter((event) => event?.topicIdentified === true && ["mechanism", "application", "discrimination"].includes(event?.masteryStage));
  const correct = eligible.filter((event) => event.correct && Number(event.answerQuality) >= 2).length;
  return { attempts: eligible.length, correct, accuracy: ratio(correct, eligible.length) };
}

export function computeEnduranceAnalytics(sessions = []) {
  const bands = Array.from({ length: 4 }, (_, index) => ({ index, attempts: 0, correct: 0, totalResponseMs: 0, timed: 0 }));
  const blocks = {};
  for (const session of sessions || []) {
    const answers = new Map((session?.answers || []).map((answer) => [answer.questionId, answer]));
    const questions = session?.questions || [];
    questions.forEach((question, index) => {
      const answer = answers.get(question.questionId);
      if (!answer) return;
      const band = bands[Math.min(3, Math.floor(index * 4 / Math.max(questions.length, 1)))];
      const blockNumber = Math.floor(index / 10) + 1;
      const block = blocks[blockNumber] || { block: blockNumber, attempts: 0, correct: 0, totalResponseMs: 0, timed: 0 };
      const correct = answer.value === question.correct;
      for (const bucket of [band, block]) {
        bucket.attempts += 1;
        bucket.correct += correct ? 1 : 0;
        if (Number.isFinite(answer.responseMs)) {
          bucket.totalResponseMs += Math.max(0, answer.responseMs);
          bucket.timed += 1;
        }
      }
      blocks[blockNumber] = block;
    });
  }
  const finish = (bucket) => ({
    ...bucket,
    accuracy: ratio(bucket.correct, bucket.attempts),
    averageResponseMs: bucket.timed ? bucket.totalResponseMs / bucket.timed : null,
  });
  const quarterRows = bands.map(finish);
  const first = quarterRows[0]?.accuracy;
  const last = quarterRows[3]?.accuracy;
  return {
    quarters: quarterRows,
    blocks: Object.values(blocks).map(finish),
    accuracyDrop: first == null || last == null ? null : first - last,
    enduranceFlag: first != null && last != null && bands[0].attempts >= 3 && bands[3].attempts >= 3 && first - last >= 0.15,
  };
}

function stageStats(events, stage) {
  const matching = events.filter((event) => event.masteryStage === stage);
  const credit = matching.filter((event) => event.correct && Number(event.answerQuality) >= 2);
  return {
    attempts: matching.length,
    correct: credit.length,
    accuracy: ratio(credit.length, matching.length),
  };
}

export function computeObjectiveMastery({ objectives = [], events = [], now = Date.now() } = {}) {
  const byObjective = new Map();
  for (const event of events) {
    for (const objectiveId of event?.objectiveIds || []) {
      if (!byObjective.has(objectiveId)) byObjective.set(objectiveId, []);
      byObjective.get(objectiveId).push(event);
    }
  }
  return (objectives || []).filter((objective) => objective?.id).map((objective, index) => {
    const objectiveEvents = (byObjective.get(objective.id) || []).sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
    const stages = Object.fromEntries(MASTERY_STAGES.map((stage) => [stage, stageStats(objectiveEvents, stage)]));
    const credited = objectiveEvents.filter((event) => event.correct && Number(event.answerQuality) >= 2);
    const sessions = new Set(credited.map((event) => event.sessionKey).filter(Boolean));
    const tasks = new Set(credited.map((event) => event.taskType).filter(Boolean));
    const latest = objectiveEvents.at(-1);
    const delayed = credited.filter((event) => event.trainingPhase === "prove" && Number(event.delayMs) >= day).length;
    const mechanism = stages.mechanism;
    const applicationAttempts = stages.application.attempts + stages.discrimination.attempts;
    const applicationCorrect = stages.application.correct + stages.discrimination.correct;
    const applicationAccuracy = ratio(applicationCorrect, applicationAttempts);
    const errorCounts = objectiveEvents.reduce((counts, event) => {
      if (event.errorCode && ERROR_TAXONOMY[event.errorCode]) counts[event.errorCode] = (counts[event.errorCode] || 0) + 1;
      return counts;
    }, {});
    const recurringError = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).find(([, count]) => count >= 2)?.[0] || null;
    const evidenceGate = credited.length >= 3 && sessions.size >= 2 && tasks.size >= 2 && latest?.correct && Number(latest?.answerQuality) >= 2;
    const examReady = evidenceGate && mechanism.attempts >= 1 && (mechanism.accuracy ?? 0) >= 0.8
      && applicationAttempts >= 2 && (applicationAccuracy ?? 0) >= 0.8 && delayed >= 1 && !recurringError;
    let stage = "exposure";
    for (const candidate of MASTERY_STAGES.slice(1, -1)) {
      const stat = stages[candidate];
      if (stat.attempts > 0 && (stat.accuracy ?? 0) >= 0.7) stage = candidate;
    }
    if (examReady) stage = "stable";
    const attempts = objectiveEvents.length;
    const qualityPoints = objectiveEvents.reduce((sum, event) => sum + Number(event.answerQuality || 0), 0);
    const qualityRate = attempts ? qualityPoints / (attempts * 3) : null;
    return {
      id: objective.id,
      code: objective.code || objective.objectiveCode || `Objective ${index + 1}`,
      text: objective.objective || objective.text || objective.title || "",
      stage,
      stages,
      attempts,
      qualityRate,
      sessionCount: sessions.size,
      taskTypeCount: tasks.size,
      delayedRetrievals: delayed,
      mechanismAccuracy: mechanism.accuracy,
      applicationAccuracy,
      recurringError,
      examReady,
      state: attempts === 0 ? "untested" : examReady ? "strong" : (qualityRate ?? 0) >= 0.67 ? "borderline" : "weak",
      lastSeen: latest?.at || null,
      daysSinceLastSeen: latest?.at ? Math.max(0, Math.floor((now - latest.at) / day)) : null,
    };
  });
}

export function forecastExam({ objectiveRows = [], sessions = [], secondStep = null, endurance = null, benchmarks = [] } = {}) {
  const tested = objectiveRows.filter((row) => row.attempts > 0);
  const strong = objectiveRows.filter((row) => row.state === "strong");
  const borderline = objectiveRows.filter((row) => row.state === "borderline");
  const weak = objectiveRows.filter((row) => row.state === "weak");
  const untested = objectiveRows.filter((row) => row.state === "untested");
  const examAnswers = sessions.flatMap((session) => {
    const byId = new Map((session.answers || []).map((answer) => [answer.questionId, answer]));
    return (session.questions || []).map((question) => ({ question, answer: byId.get(question.questionId) })).filter((row) => row.answer);
  });
  const examAccuracy = ratio(examAnswers.filter(({ question, answer }) => answer.value === question.correct).length, examAnswers.length);
  const objectiveScore = tested.length ? tested.reduce((sum, row) => sum + (row.qualityRate ?? 0), 0) / tested.length : null;
  const coverage = objectiveRows.length ? tested.length / objectiveRows.length : 0;
  const second = secondStep?.accuracy;
  const endurancePenalty = endurance?.accuracyDrop == null ? 0 : clamp(endurance.accuracyDrop, 0, 0.2) * 0.35;
  const raw = 100 * clamp(
    0.5 * (examAccuracy ?? 0.5) + 0.25 * (objectiveScore ?? 0.4) + 0.15 * (second ?? 0.45) + 0.1 * coverage - endurancePenalty,
    0.3,
    0.95
  );
  const completed = (benchmarks || []).filter((item) => Number.isFinite(item?.predictedPercent) && Number.isFinite(item?.actualPercent));
  const calibrationBias = completed.length
    ? completed.reduce((sum, item) => sum + item.actualPercent - item.predictedPercent, 0) / completed.length
    : 0;
  const predicted = clamp(raw + calibrationBias, 0, 100);
  const evidence = examAnswers.length + tested.reduce((sum, row) => sum + row.attempts, 0);
  const halfWidth = clamp(14 - Math.sqrt(evidence) * 0.7 + (1 - coverage) * 8, 5, 20);
  const limiters = [
    ...weak.map((row) => ({ type: "objective", id: row.id, label: row.text || row.code, impact: 3 + row.attempts })),
    ...untested.map((row) => ({ type: "objective", id: row.id, label: row.text || row.code, impact: 2 })),
    ...(second != null && second < 0.8 ? [{ type: "skill", id: "second-step", label: "Second-step mechanistic inference", impact: 7 }] : []),
    ...(endurance?.enduranceFlag ? [{ type: "skill", id: "endurance", label: "Late-block endurance", impact: 6 }] : []),
  ].sort((a, b) => b.impact - a.impact);
  const roi = [...weak, ...borderline, ...untested].map((row) => ({
    id: row.id,
    label: row.text || row.code,
    state: row.state,
    roi: (row.state === "weak" ? 5 : row.state === "untested" ? 4 : 3)
      + (row.mechanismAccuracy != null && row.mechanismAccuracy < 0.8 ? 2 : 0)
      + (row.applicationAccuracy != null && row.applicationAccuracy < 0.8 ? 2 : 0),
  })).sort((a, b) => b.roi - a.roi);
  return {
    predictedPercent: Math.round(predicted * 10) / 10,
    range: [Math.round(clamp(predicted - halfWidth, 0, 100)), Math.round(clamp(predicted + halfWidth, 0, 100))],
    targetPercent: 80,
    confidence: evidence >= 80 && coverage >= 0.8 ? "higher" : evidence >= 30 && coverage >= 0.5 ? "moderate" : "low",
    evidenceCount: evidence,
    coverage,
    counts: { strong: strong.length, borderline: borderline.length, weak: weak.length, untested: untested.length },
    primaryLimiter: limiters[0] || null,
    secondaryLimiter: limiters[1] || null,
    highestRoi: roi.slice(0, 5),
    calibrationBias,
  };
}

export function comparePredictionToActual(benchmarks = []) {
  const rows = (benchmarks || []).filter((item) => Number.isFinite(item?.actualPercent)).map((item) => ({
    ...item,
    predictionError: Number.isFinite(item.predictedPercent) ? item.actualPercent - item.predictedPercent : null,
    insideRange: Array.isArray(item.predictedRange) && item.predictedRange.length === 2
      ? item.actualPercent >= item.predictedRange[0] && item.actualPercent <= item.predictedRange[1]
      : null,
  }));
  const calibrated = rows.filter((row) => row.predictionError != null);
  return {
    rows,
    count: calibrated.length,
    meanError: calibrated.length ? calibrated.reduce((sum, row) => sum + row.predictionError, 0) / calibrated.length : null,
    meanAbsoluteError: calibrated.length ? calibrated.reduce((sum, row) => sum + Math.abs(row.predictionError), 0) / calibrated.length : null,
  };
}

export function eventsFromSessions(sessions = []) {
  return (sessions || []).flatMap((session) => {
    const answers = new Map((session?.answers || []).map((answer) => [answer.questionId, answer]));
    return (session?.questions || []).flatMap((question) => {
      const answer = answers.get(question.questionId);
      if (!answer) return [];
      const correct = answer.value === question.correct;
      const masteryStage = masteryStageForTask(question.taskType, question.reasoningDepth);
      return [{
        objectiveIds: question.objectiveIds || [],
        correct,
        answerQuality: Number.isFinite(answer.answerQuality) ? answer.answerQuality : answerQuality({ correct, confidence: answer.confidence }),
        confidence: answer.confidence || null,
        topicIdentified: answer.topicIdentified === true,
        errorCode: answer.errorCode || null,
        taskType: question.taskType || null,
        masteryStage,
        trainingPhase: question.trainingPhase || (String(question.taskType || "").startsWith("prove") ? "prove" : null),
        delayMs: Number(question.delayMs || answer.delayMs || (Number.isFinite(question.generatedAt) && Number.isFinite(answer.answeredAt) ? Math.max(0, answer.answeredAt - question.generatedAt) : 0)),
        sessionKey: session.sessionId || session.id || null,
        at: answer.answeredAt || session.submittedAt || session.startedAt || null,
      }];
    });
  });
}
