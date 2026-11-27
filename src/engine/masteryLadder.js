// Mastery ladder: each objective climbs Recall -> Application -> Discrimination ->
// Integration -> Mastered (delayed retest). Only independent answers whose
// reasoning depth was independently verified count; a miss drops one rung and
// asks for a repair variant (a confident miss, confidence 4-5, drops two rungs
// and asks for a misconception repair); a low-confidence correct counts as half a step.

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

export function ladderForObjective(entry, { now = Date.now(), examDate = null, parts: parts_ = null } = {}) {
  const answers = (entry?.recentFreshAnswers || [])
    .filter(a => a && a.reasoningVerified === true && a.assisted !== true)
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  let rung = 0, credit = 0, confident = false, repairDue = false, misconceptionDue = false, reachedIntegrationAt = null;
  for (const a of answers) {
    const need = REQUIREMENTS[rung];
    if (!need) break;
    if (!a.correct) {
      // Being sure and wrong means a wrong belief, not a gap, so it costs more.
      misconceptionDue = isConfident(a);
      rung = Math.max(0, rung - (misconceptionDue ? 2 : 1)); credit = 0; confident = false; repairDue = true; reachedIntegrationAt = rung >= 4 ? reachedIntegrationAt : null;
      continue;
    }
    if (!need.qualifies(a)) continue;
    if (need.delayed && (!reachedIntegrationAt || dayOf(a.at) <= dayOf(reachedIntegrationAt) || a.at < reachedIntegrationAt + retentionDelay(reachedIntegrationAt, examDate) - DAY / 2)) continue;
    credit += confidenceWeight(a);
    confident = confident || isConfident(a) || !Number.isFinite(Number(a.confidence));
    repairDue = false; misconceptionDue = false;
    if (credit >= need.needed && (!need.needsConfident || confident)) {
      rung += 1; credit = 0; confident = false;
      if (rung === 4) reachedIntegrationAt = a.at;
    }
  }
  // Every lecture element the objective covers needs one independent correct
  // answer before the objective counts as mastered (engine/objectiveParts.js).
  const parts = Array.isArray(parts_) ? parts_ : [];
  const partsMissing = parts.filter(part => !part.covered);
  const heldForParts = rung === 5 && partsMissing.length > 0;
  if (heldForParts) rung = 4;
  const need = REQUIREMENTS[rung];
  const retestDueAt = rung === 4 && reachedIntegrationAt ? reachedIntegrationAt + retentionDelay(reachedIntegrationAt, examDate) : null;
  return {
    rung, label: LADDER_RUNGS[rung].label,
    progress: need && need.needed > 1 ? `${Math.floor(credit)}/${need.needed}` : null,
    repairDue, misconceptionDue,
    retestDueAt: heldForParts ? null : retestDueAt, retestDue: !heldForParts && retestDueAt != null && now >= retestDueAt,
    next: heldForParts
      ? { step: "parts", targetOrder: "second-order", partIds: partsMissing.map(part => part.id) }
      : need ? { step: need.step, targetOrder: need.targetOrder, ...(need.taskType ? { taskType: need.taskType } : {}), ...(repairDue ? { repair: true } : {}), ...(misconceptionDue ? { misconception: true } : {}) } : null,
    ...(parts.length ? { parts: { total: parts.length, covered: parts.length - partsMissing.length, missing: partsMissing.map(part => ({ id: part.id, label: part.label })) } } : {}),
  };
}

/** Per-block view: objectives per rung and readiness (share of emphasis-weighted objectives at Integration or above). */
export function blockLadderSummary(objectives = [], evidence = {}, options = {}) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let weight = 0, ready = 0;
  const rows = objectives.map(objective => {
    const ladder = ladderForObjective(evidence?.objectives?.[objective.id], { ...options, parts: options.partsByObjective?.[objective.id] || objective._parts || null });
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
    const ladder = ladderForObjective(evidence?.objectives?.[objective.id], { ...options, parts: options.partsByObjective?.[objective.id] || objective._parts || null });
    if (!ladder.next) return { ...objective, _ladderRung: ladder.rung, _ladderLabel: ladder.label };
    const base = { ...objective, _ladderRung: ladder.rung, _ladderLabel: ladder.label, _ladderStep: ladder.next.step, ...(ladder.next.repair ? { _ladderRepair: true } : {}), ...(ladder.next.misconception ? { _ladderMisconception: true } : {}) };
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
  discrimination: 'DISCRIMINATION: choose the contrast set from what THIS lecture teaches for the objective\'s decision. Two-way when the lecture contrasts a pair (e.g. bipolar I vs II, grief vs major depression): the key and the closest distractor are that pair, and the stem contains the one finding that separates them (duration, impairment, laterality, timing, a lab value). Multi-way when the lecture (or the objective\'s parts) teaches 3 or more options that compete for the same decision (e.g. CBT vs SSRI vs benzodiazepine vs beta blocker for an anxiety disorder; several disorders sharing a presentation): make 3-4 choices real members of that set, each plausible on first read, and put in the stem a distinct finding that rules out each non-key member (onset timing, dependence risk, comorbidity, performance-only symptoms). Never pad a multi-way set with options the lecture does not teach. Set taskType "discrimination" and list the contrasted letters (key included) in "discriminationSet".',
  integration: 'INTEGRATION: require two taught relationships joined through an unstated intermediate (third-order where the objective allows it).',
  parts: 'PARTS: the objective is otherwise secure; write an application item on one of its untested parts (see OBJECTIVE PARTS testNext).',
  retention: 'RETENTION: a fresh case on an already-learned relationship with a different presentation and requested endpoint than before; set taskType "fresh-retest".',
};
/** Writer instructions for the ladder steps present in this batch. */
export function ladderStepPrompt(objectives = []) {
  const rows = objectives.filter(objective => objective._ladderStep).map(objective => ({ objectiveId: objective.id || objective.code, step: objective._ladderStep, ...(objective._ladderRepair ? { repair: true } : {}), ...(objective._ladderMisconception ? { misconception: true } : {}) }));
  if (!rows.length) return "";
  const steps = [...new Set(rows.map(row => row.step))];
  return `\nMASTERY LADDER STEPS (write each objective's item for its step; a repair item re-tests the same relationship that was just missed, with a different presentation; a misconception repair follows a confident wrong answer: make the belief that answer reflects the most tempting distractor, and have the explanation name that belief and the stem finding that rules it out):\n${JSON.stringify(rows)}\n${steps.map(step => STEP_GUIDE[step]).filter(Boolean).join("\n")}\n`;
}
