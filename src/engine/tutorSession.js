/**
 * Pure state machine for a bounded, resumable lecture-tutor session.
 * The UI/AI layer supplies turns; this module owns time, continuity, and
 * objective/blocker state so leaving a lecture can never silently restart it.
 */

const BUDGETS = new Set([30, 45, 60]);

const STEP_ORDER = ["diagnosis", "mechanism", "consequence", "contrast"];

export function tutorStepPrompt({ step = "retrieval", objectiveText = "this objective", atomTerms = [] } = {}) {
  const terms = atomTerms.filter(Boolean).slice(0, 4).join(", ");
  const prompts = {
    retrieval: `Without looking at your notes, what do you already remember about ${objectiveText}? Start with the patient problem or syndrome.`,
    patient_case: `What is the most likely diagnosis or disease family? Name the syndrome first if you are not yet certain.`,
    diagnosis: `What is the most likely diagnosis or disease family? Name the syndrome first if you are not yet certain.`,
    mechanism: `Explain ${objectiveText} as a causal chain. What starts the process, what tissue or pathway is affected, and how does that produce the findings?`,
    consequence: `Given ${objectiveText}, what should happen next: a lab finding, symptom, complication, or treatment response? Explain why.`,
    contrast: `What is the closest mimic of ${objectiveText}, and what single finding would separate the two?`,
  };
  return {
    step,
    label: step.replace(/_/g, " "),
    prompt: prompts[step] || prompts.retrieval,
    terms,
    scaffold: terms ? `Useful lecture terms to connect: ${terms}.` : "Use the lecture objective and your own causal reasoning.",
    nextStep: STEP_ORDER[Math.min(Math.max(STEP_ORDER.indexOf(step), 0) + 1, STEP_ORDER.length - 1)] || "diagnosis",
  };
}

export function createTutorSession({ lectureId, budgetMinutes = 30, objectiveIds = [], now = Date.now() } = {}) {
  const budget = BUDGETS.has(Number(budgetMinutes)) ? Number(budgetMinutes) : 30;
  const ids = [...new Set((objectiveIds || []).map(String).filter(Boolean))];
  return {
    version: 1,
    sessionId: `tutor_${lectureId || "lecture"}_${now}`,
    lectureId: lectureId || null,
    budgetMinutes: budget,
    status: "active",
    phase: "resume",
    startedAt: now,
    lastCheckpointAt: now,
    elapsedSeconds: 0,
    remainingSeconds: budget * 60,
    objectiveIds: ids,
    completedObjectiveIds: [],
    activeObjectiveId: ids[0] || null,
    currentStep: "retrieval",
    blockers: [],
    turns: [],
    nextAction: ids.length ? "retrieve_previous_state" : "build_patient_case",
    openingModel: null,
    patientCase: null,
  };
}

export function attachTutorCase(state, patientCase, now = Date.now(), openingModel = null) {
  if (!state || !patientCase) return state;
  return checkpoint(state, {
    ...(openingModel ? { openingModel } : {}),
    patientCase,
    currentStep: "diagnosis",
    nextAction: "identify_diagnosis",
  }, now);
}

function checkpoint(state, patch = {}, now = Date.now()) {
  return { ...state, ...patch, lastCheckpointAt: now };
}

export function recordTutorTurn(state, turn, now = Date.now()) {
  if (!state || state.status !== "active") return state;
  const nextTurns = [...(state.turns || []), { ...turn, at: now }];
  const objectiveId = turn?.objectiveId ? String(turn.objectiveId) : state.activeObjectiveId;
  const completed = turn?.objectiveComplete && objectiveId
    ? [...new Set([...(state.completedObjectiveIds || []), objectiveId])]
    : state.completedObjectiveIds || [];
  const blockers = turn?.blocker
    ? [...(state.blockers || []), { ...turn.blocker, objectiveId, at: now }]
    : state.blockers || [];
  const nextObjectiveId = turn?.objectiveComplete
    ? (state.objectiveIds || []).find((id) => !completed.includes(id)) || null
    : objectiveId || state.activeObjectiveId;
  const finishedAllObjectives = Boolean(turn?.objectiveComplete && !nextObjectiveId);
  return checkpoint(state, {
    turns: nextTurns,
    completedObjectiveIds: completed,
    activeObjectiveId: nextObjectiveId || objectiveId || state.activeObjectiveId,
    currentStep: nextObjectiveId !== objectiveId ? "retrieval" : (turn?.nextStep || state.currentStep),
    patientCase: nextObjectiveId !== objectiveId ? null : state.patientCase,
    blockers,
    status: finishedAllObjectives ? "finished" : state.status,
    phase: finishedAllObjectives ? "summary" : state.phase,
    nextAction: finishedAllObjectives
      ? "review_checkpoint"
      : (nextObjectiveId !== objectiveId ? "build_patient_case" : (turn?.nextAction || state.nextAction)),
  }, now);
}

export function tickTutorSession(state, seconds, now = Date.now()) {
  if (!state || state.status !== "active") return state;
  const elapsed = Math.max(0, Number(seconds) || 0);
  const remaining = Math.max(0, state.remainingSeconds - elapsed);
  const next = checkpoint(state, {
    elapsedSeconds: state.elapsedSeconds + elapsed,
    remainingSeconds: remaining,
    status: remaining === 0 ? "checkpoint" : "active",
    phase: remaining === 0 ? "checkpoint" : state.phase,
    nextAction: remaining === 0 ? "resume_or_stop" : state.nextAction,
  }, now);
  return next;
}

export function pauseTutorSession(state, now = Date.now()) {
  if (!state || state.status !== "active") return state;
  return checkpoint(state, { status: "paused", nextAction: "resume_session" }, now);
}

export function resumeTutorSession(state, now = Date.now()) {
  if (!state || !["paused", "checkpoint"].includes(state.status)) return state;
  return checkpoint(state, { status: "active", phase: "resume", nextAction: "retrieve_previous_state" }, now);
}

export function finishTutorSession(state, now = Date.now()) {
  if (!state || state.status === "finished") return state;
  return checkpoint(state, { status: "finished", phase: "summary", nextAction: "review_checkpoint" }, now);
}

export function tutorSessionSummary(state) {
  const objectiveIds = state?.objectiveIds || [];
  const completed = new Set(state?.completedObjectiveIds || []);
  return {
    lectureId: state?.lectureId || null,
    budgetMinutes: state?.budgetMinutes || 0,
    status: state?.status || "unknown",
    elapsedSeconds: state?.elapsedSeconds || 0,
    remainingSeconds: state?.remainingSeconds || 0,
    objectivesCompleted: objectiveIds.filter((id) => completed.has(id)).length,
    objectivesTotal: objectiveIds.length,
    blockerCount: (state?.blockers || []).length,
    unresolvedBlockers: (state?.blockers || []).filter((blocker) => blocker.status !== "resolved").length,
    nextAction: state?.nextAction || null,
  };
}
