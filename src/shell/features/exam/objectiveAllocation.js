import { normalizeQuestionOrder } from '../../../engine/questionOrder.js';

const identity = objective => String(objective.id || objective.code);
const quota = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const levels = ['first-order', 'second-order', 'third-order'];

/** Retain a whole-set quota across small requests; rejected items never consume slots. */
export function remainingObjectiveAllocation(plan = [], questions = [], limit = Infinity) {
  const counts = new Map();
  for (const question of questions) for (const id of new Set(question.objectiveIds || [])) counts.set(String(id), (counts.get(String(id)) || 0) + 1);
  const rows = plan.map(objective => ({...objective, _targetQuestionCount: Math.max(0, quota(objective._targetQuestionCount) - (counts.get(identity(objective)) || 0))}));
  const allocation = new Map();
  let remaining = limit;
  // Spread each batch before assigning another slot to the same objective.
  while (remaining > 0) {
    let added = false;
    for (const row of rows) {
      const id = identity(row), count = allocation.get(id) || 0;
      if (remaining <= 0) break;
      if (count >= row._targetQuestionCount) continue;
      allocation.set(id, count + 1); remaining--; added = true;
    }
    if (!added) break;
  }
  return rows.filter(row => allocation.has(identity(row))).map(row => ({...row, _targetQuestionCount: allocation.get(identity(row))}));
}

/** Called after current review eligibility; it adds scope, quota and depth checks. */
export function fitsObjectiveAllocation(question, remaining = []) {
  if (question.objectiveIds?.length !== 1) return false;
  const target = remaining.find(objective => identity(objective) === String(question.objectiveIds[0]));
  if (!target || !(target._targetQuestionCount > 0)) return false;
  const required = normalizeQuestionOrder(target._targetOrder || 'second-order');
  const actual = normalizeQuestionOrder(question.orderLevel);
  return !!required && !!actual && levels.indexOf(actual) >= levels.indexOf(required);
}
