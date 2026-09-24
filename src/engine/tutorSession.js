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
    delayed_retrieval: "Without looking at the earlier feedback, retrieve the diagnosis and explain the key mechanism in your own words.",
    mechanism: `Explain ${objectiveText} as a causal chain. What starts the process, what tissue or pathway is affected, and how does that produce the findings?`,
    consequence: `Given ${objectiveText}, what should happen next: a lab finding, symptom, complication, or treatment response? Explain why.`,
    contrast: `What is the closest mimic of ${objectiveText}, and what single finding would separate the two?`,
  };
  const scaffoldByStep = {
    diagnosis: "Start with the organ system, time course, and the clue that best localizes the problem.",
    delayed_retrieval: "Try from memory first. Name the pattern, then connect it to the mechanism.",
    mechanism: `Trace cause → affected tissue or pathway → physiologic change.${terms ? ` Useful lecture terms: ${terms}.` : ""}`,
    consequence: `Use the mechanism to predict one finding, complication, or treatment response.${terms ? ` Useful lecture terms: ${terms}.` : ""}`,
    contrast: `Name the closest mimic, then identify one finding that separates them.${terms ? ` Useful lecture terms: ${terms}.` : ""}`,
  };
  return {
    step,
    label: step.replace(/_/g, " "),
    prompt: prompts[step] || prompts.retrieval,
    terms,
    scaffold: scaffoldByStep[step] || (terms ? `Useful lecture terms to connect: ${terms}.` : "Use the lecture objective and your own causal reasoning."),
    nextStep: STEP_ORDER[Math.min(Math.max(STEP_ORDER.indexOf(step), 0) + 1, STEP_ORDER.length - 1)] || "diagnosis",
  };
}

export function createTutorSession({ lectureId, budgetMinutes = 30, objectiveIds = [], learnerProfile = null, retrievalQueue = [], now = Date.now() } = {}) {
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
    retrievalQueue: [...(retrievalQueue || [])],
    delayedReview: null,
    resumeObjectiveId: null,
    learnerProfile: learnerProfile || { confirmedAnchors: [], recentMisses: [], confidenceEvents: [], reasoningSkillEvidence: [], stableReasoningSkills: [] },
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

function updateLearnerProfile(state, turn, objectiveId, now) {
  const prior = state.learnerProfile || {};
  const confirmedAnchors = [...(prior.confirmedAnchors || [])];
  const recentMisses = [...(prior.recentMisses || [])];
  const confidenceEvents = [...(prior.confidenceEvents || [])];
  const reasoningSkillEvidence = [...(prior.reasoningSkillEvidence || [])];
  if (turn?.stepResolved && turn.response) {
    confirmedAnchors.push({
      objectiveId,
      step: turn.reviewedStep || state.currentStep,
      response: turn.response,
      at: now,
    });
  }
  if (turn?.stepResolved) {
    for (let index = recentMisses.length - 1; index >= 0; index -= 1) {
      const miss = recentMisses[index];
      if (String(miss.objectiveId) === String(objectiveId) && miss.step === (turn.reviewedStep || state.currentStep) && miss.status !== "resolved") {
        recentMisses[index] = { ...miss, status: "resolved", resolvedAt: now };
      }
    }
  }
  if (!turn?.stepResolved && turn?.missType) {
    recentMisses.push({
      objectiveId,
      step: turn.reviewedStep || state.currentStep,
      missType: turn.missType,
      repairLink: turn.repairLink || "",
      status: "open",
      at: now,
    });
  }
  if (turn?.confidence) {
    confidenceEvents.push({
      objectiveId,
      confidence: turn.confidence,
      assessment: turn.assessment || "unknown",
      confidenceNote: turn.confidenceNote || "",
      step: turn.reviewedStep || state.currentStep,
      at: now,
    });
  }
  if (turn?.stepResolved && turn.reasoningSkill) {
    reasoningSkillEvidence.push({ objectiveId, skill: turn.reasoningSkill, at: now });
  }
  const recentSkillEvidence = reasoningSkillEvidence.slice(-40);
  const stableReasoningSkills = [...new Set(recentSkillEvidence
    .filter((entry) => recentSkillEvidence.some((other) => other.skill === entry.skill && other.objectiveId !== entry.objectiveId))
    .map((entry) => entry.skill))];
  return {
    confirmedAnchors: confirmedAnchors.slice(-16),
    recentMisses: recentMisses.slice(-16),
    confidenceEvents: confidenceEvents.slice(-32),
    reasoningSkillEvidence: recentSkillEvidence,
    stableReasoningSkills,
  };
}

export function recordTutorTurn(state, turn, now = Date.now()) {
  if (!state || state.status !== "active") return state;
  const nextTurns = [...(state.turns || []), { ...turn, at: now }];
  const reviewingEarlierCase = state.currentStep === "delayed_retrieval" && state.delayedReview;
  const objectiveId = turn?.objectiveId
    ? String(turn.objectiveId)
    : (reviewingEarlierCase?.objectiveId || state.activeObjectiveId);
  const completed = turn?.objectiveComplete && objectiveId
    ? [...new Set([...(state.completedObjectiveIds || []), objectiveId])]
    : state.completedObjectiveIds || [];
  const blockers = (state.blockers || []).map((blocker) => (
    turn?.stepResolved
      && String(blocker.objectiveId) === String(objectiveId)
      && blocker.step === turn.reviewedStep
      && blocker.status !== "resolved"
      ? { ...blocker, status: "resolved", resolvedAt: now }
      : blocker
  ));
  if (turn?.blocker) blockers.push({ ...turn.blocker, objectiveId, at: now });
  const learnerProfile = updateLearnerProfile(state, turn, objectiveId, now);
  if (reviewingEarlierCase) {
    const reviewComplete = turn?.delayedReviewComplete === true;
    const resumedObjectiveId = state.resumeObjectiveId;
    const reviewCompletedObjectives = reviewComplete
      ? [...new Set([...completed, String(state.delayedReview.objectiveId)])]
      : completed;
    const allObjectivesDone = !resumedObjectiveId
      && (state.objectiveIds || []).every((id) => reviewCompletedObjectives.includes(id));
    return checkpoint(state, {
      turns: nextTurns,
      completedObjectiveIds: reviewCompletedObjectives,
      blockers,
      learnerProfile,
      delayedReview: reviewComplete ? null : state.delayedReview,
      activeObjectiveId: resumedObjectiveId || state.delayedReview.objectiveId,
      resumeObjectiveId: reviewComplete ? null : resumedObjectiveId,
      currentStep: reviewComplete ? (resumedObjectiveId ? "retrieval" : "contrast") : "delayed_retrieval",
      patientCase: reviewComplete
        ? (resumedObjectiveId ? null : state.delayedReview)
        : state.patientCase,
      status: reviewComplete && allObjectivesDone ? "finished" : state.status,
      phase: reviewComplete && allObjectivesDone ? "summary" : state.phase,
      nextAction: reviewComplete
        ? (allObjectivesDone ? "review_checkpoint" : "build_patient_case")
        : "retrieve_earlier_case",
    }, now);
  }
  let nextObjectiveId = turn?.objectiveComplete
    ? (state.objectiveIds || []).find((id) => !completed.includes(id)) || null
    : objectiveId || state.activeObjectiveId;
  let retrievalQueue = [...(state.retrievalQueue || [])];
  let delayedReview = null;
  let resumeObjectiveId = null;
  if (turn?.objectiveComplete && state.patientCase) {
    retrievalQueue = [...retrievalQueue, {
      objectiveId,
      dueAfterCompletedObjectives: completed.length + 1,
      caseTitle: state.patientCase.caseTitle,
      stem: state.patientCase.stem,
      expectedDiagnosis: state.patientCase.diagnosisCategory || "",
      mechanismTarget: state.patientCase.mechanismTarget || "",
      keyClues: state.patientCase.keyClues || [],
      dueAt: now + (24 * 60 * 60 * 1000),
    }];
  }
  if (turn?.objectiveComplete) {
    const dueIndex = retrievalQueue.findIndex((item) => item.dueAfterCompletedObjectives <= completed.length || (item.dueAt && item.dueAt <= now));
    if (dueIndex >= 0) {
      [delayedReview] = retrievalQueue.splice(dueIndex, 1);
      resumeObjectiveId = (state.objectiveIds || []).find((id) => (
        id !== String(delayedReview.objectiveId) && !completed.includes(id)
      )) || null;
    }
  }
  const finishedAllObjectives = Boolean(turn?.objectiveComplete && !nextObjectiveId && !delayedReview);
  return checkpoint(state, {
    turns: nextTurns,
    completedObjectiveIds: completed,
    activeObjectiveId: delayedReview?.objectiveId || nextObjectiveId || objectiveId || state.activeObjectiveId,
    currentStep: delayedReview ? "delayed_retrieval" : (nextObjectiveId !== objectiveId ? "retrieval" : (turn?.nextStep || state.currentStep)),
    patientCase: delayedReview || nextObjectiveId !== objectiveId ? null : state.patientCase,
    retrievalQueue,
    delayedReview,
    resumeObjectiveId,
    blockers,
    learnerProfile,
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
  let retrievalQueue = [...(state.retrievalQueue || [])];
  const unfinishedCase = state.delayedReview || (state.patientCase && !state.completedObjectiveIds?.includes(state.activeObjectiveId) ? state.patientCase : null);
  if (unfinishedCase && !retrievalQueue.some((entry) => entry.objectiveId === (unfinishedCase.objectiveId || state.activeObjectiveId))) {
    retrievalQueue.push({
      ...unfinishedCase,
      objectiveId: unfinishedCase.objectiveId || state.activeObjectiveId,
      expectedDiagnosis: unfinishedCase.expectedDiagnosis || unfinishedCase.diagnosisCategory || "",
      mechanismTarget: unfinishedCase.mechanismTarget || "",
      dueAt: now + (24 * 60 * 60 * 1000),
      dueAfterCompletedObjectives: Number.MAX_SAFE_INTEGER,
    });
  }
  return checkpoint(state, { status: "finished", phase: "summary", retrievalQueue, delayedReview: null, nextAction: "review_checkpoint" }, now);
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
