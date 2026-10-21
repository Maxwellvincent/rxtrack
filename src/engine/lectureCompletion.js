import {objectivePracticePlan} from './objectivePractice.js';
/** First-pass completion is distinct from accuracy and mastery. */
export function lectureCompletion(objectives=[],evidence={}) {
 const plan=objectivePracticePlan(objectives,evidence);
 const tested=new Set(plan.rows.filter(row=>row.worked).map(row=>row.id));
 const reviewed=objectives.filter(o=>o.reviewedAt && !tested.has(o.id)).length;
 const covered=tested.size+reviewed;
 return {total:objectives.length,tested:tested.size,reviewed,covered,remaining:Math.max(0,objectives.length-covered),complete:objectives.length>0 && covered===objectives.length};
}
