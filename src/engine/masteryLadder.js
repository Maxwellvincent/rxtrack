// Mastery ladder: each objective climbs Recall -> Application -> Discrimination ->
// Integration -> Mastered (delayed retest). Only independent answers whose
// reasoning depth was independently verified count; a miss drops one rung and
// asks for a repair variant; a low-confidence correct counts as half a step.

const DAY = 86_400_000;
export const CONFIDENT = 4;

export const LADDER_RUNGS = [
  { rung: 0, label: "Unseen" },
  { rung: 1, label: "Recall" },
  { rung: 2, label: "Application" },
  { rung: 3, label: "Discrimination" },
  { rung: 4, label: "Integration" },
  { rung: 5, label: "Mastered" },
];

// What it takes to leave each rung.
const REQUIREMENTS = {
  0: { step: "recall", needed: 1, qualifies: () => true, targetOrder: "first-order" },
  1: { step: "application", needed: 2, qualifies: a => ["second-order", "third-order"].includes(a.orderLevel), targetOrder: "second-order", taskType: "clinical-application" },
  2: { step: "discrimination", needed: 2, qualifies: a => a.taskType === "discrimination", targetOrder: "second-order", taskType: "discrimination", needsConfident: true },
  3: { step: "integration", needed: 1, qualifies: a => a.orderLevel === "third-order" || a.crossLecture === true, targetOrder: "third-order" },
  4: { step: "retention", needed: 1, qualifies: a => ["second-order", "third-order"].includes(a.orderLevel), targetOrder: "second-order", taskType: "fresh-retest", delayed: true },
};

const confidenceWeight = a => (Number.isFinite(Number(a.confidence)) && Number(a.confidence) < 3 ? 0.5 : 1);
const isConfident = a => Number(a.confidence) >= CONFIDENT;
const dayOf = ms => Math.floor(Number(ms) / DAY);

/** Retention spacing: 2 days normally, 1 day when the exam is within a week. */
export function retentionDelay(now, examDate) {
  return examDate && Number(examDate) - Number(now) <= 7 * DAY ? DAY : 2 * DAY;
}

export function ladderForObjective(entry, { now = Date.now(), examDate = null } = {}) {
  const answers = (entry?.recentFreshAnswers || [])
    .filter(a => a && a.reasoningVerified === true && a.assisted !== true)
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  let rung = 0, credit = 0, confident = false, repairDue = false, reachedIntegrationAt = null;
  for (const a of answers) {
    const need = REQUIREMENTS[rung];
    if (!need) break;
    if (!a.correct) {
      rung = Math.max(0, rung - 1); credit = 0; confident = false; repairDue = true; reachedIntegrationAt = rung >= 4 ? reachedIntegrationAt : null;
      continue;
    }
    if (!need.qualifies(a)) continue;
    if (need.delayed && (!reachedIntegrationAt || dayOf(a.at) <= dayOf(reachedIntegrationAt) || a.at < reachedIntegrationAt + retentionDelay(reachedIntegrationAt, examDate) - DAY / 2)) continue;
    credit += confidenceWeight(a);
    confident = confident || isConfident(a) || !Number.isFinite(Number(a.confidence));
    repairDue = false;
    if (credit >= need.needed && (!need.needsConfident || confident)) {
      rung += 1; credit = 0; confident = false;
      if (rung === 4) reachedIntegrationAt = a.at;
    }
  }
  const need = REQUIREMENTS[rung];
  const retestDueAt = rung === 4 && reachedIntegrationAt ? reachedIntegrationAt + retentionDelay(reachedIntegrationAt, examDate) : null;
  return {
    rung, label: LADDER_RUNGS[rung].label,
    progress: need && need.needed > 1 ? `${Math.floor(credit)}/${need.needed}` : null,
    repairDue,
    retestDueAt, retestDue: retestDueAt != null && now >= retestDueAt,
    next: need ? { step: need.step, targetOrder: need.targetOrder, ...(need.taskType ? { taskType: need.taskType } : {}), ...(repairDue ? { repair: true } : {}) } : null,
  };
}

/** Per-block view: objectives per rung and readiness (share of emphasis-weighted objectives at Integration or above). */
export function blockLadderSummary(objectives = [], evidence = {}, options = {}) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let weight = 0, ready = 0;
  const rows = objectives.map(objective => {
    const ladder = ladderForObjective(evidence?.objectives?.[objective.id], options);
    counts[ladder.rung] += 1;
    const w = 1 + (Number(objective._schoolEmphasis) || 0);
    weight += w; if (ladder.rung >= 4) ready += w;
    return { objective, ladder };
  });
  return { counts, rows, readyShare: weight ? ready / weight : 0 };
}

const ORDERS = ["first-order", "second-order", "third-order"];
/**
 * Point each objective at its next ladder rung. Explicit repair or connection
 * targets (_transferOrder) keep priority; a rung's order is capped by what the
 * objective's wording allows (allowedOrders, from objectiveOrderProfile).
 */
export function withLadderTargets(objectives = [], evidence = {}, options = {}, allowedOrders = () => ORDERS) {
  return objectives.map(objective => {
    const ladder = ladderForObjective(evidence?.objectives?.[objective.id], options);
    if (!ladder.next) return { ...objective, _ladderRung: ladder.rung, _ladderLabel: ladder.label };
    const base = { ...objective, _ladderRung: ladder.rung, _ladderLabel: ladder.label, _ladderStep: ladder.next.step, ...(ladder.next.repair ? { _ladderRepair: true } : {}) };
    if (objective._transferOrder) return base;
    const allowed = allowedOrders(objective) || ORDERS;
    const wanted = ladder.next.targetOrder;
    const target = allowed.includes(wanted) ? wanted : [...ORDERS].reverse().find(order => allowed.includes(order) && ORDERS.indexOf(order) <= ORDERS.indexOf(wanted)) || allowed[0];
    // The ladder may raise an objective's depth but never lowers a target that
    // other policy set (Hard/Expert exams, application-earned integration).
    const existing = ORDERS.indexOf(objective._targetOrder);
    return { ...base, _targetOrder: existing > ORDERS.indexOf(target) ? objective._targetOrder : target };
  });
}

const STEP_GUIDE = {
  recall: 'RECALL: a direct, school-level question on one taught fact or criterion (first-order is correct here; do not dress it up).',
  application: 'APPLICATION: a school-style case that applies one taught relationship to new findings.',
  discrimination: 'DISCRIMINATION: the key and the closest distractor must be two conditions, structures or mechanisms that THIS lecture explicitly contrasts (e.g. bipolar I vs II, grief vs major depression). The stem must contain the one finding that separates them (duration, impairment, laterality, timing, a lab value). Set taskType "discrimination".',
  integration: 'INTEGRATION: require two taught relationships joined through an unstated intermediate (third-order where the objective allows it).',
  retention: 'RETENTION: a fresh case on an already-learned relationship with a different presentation and requested endpoint than before; set taskType "fresh-retest".',
};
/** Writer instructions for the ladder steps present in this batch. */
export function ladderStepPrompt(objectives = []) {
  const rows = objectives.filter(objective => objective._ladderStep).map(objective => ({ objectiveId: objective.id || objective.code, step: objective._ladderStep, ...(objective._ladderRepair ? { repair: true } : {}) }));
  if (!rows.length) return "";
  const steps = [...new Set(rows.map(row => row.step))];
  return `\nMASTERY LADDER STEPS (write each objective's item for its step; a repair item re-tests the same relationship that was just missed, with a different presentation):\n${JSON.stringify(rows)}\n${steps.map(step => STEP_GUIDE[step]).filter(Boolean).join("\n")}\n`;
}
