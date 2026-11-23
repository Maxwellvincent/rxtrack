import {objectivesWithConnectionGaps} from '../../../engine/objectiveConnections.js';
import {repairTransferPlan,repairTransferRequest} from '../../../engine/repairTransfer.js';
import {objectivePracticePlan} from '../../../engine/objectivePractice.js';
/** The progression display and ordinary quiz launch must describe the same target. */
export function lecturePracticeTargets(objectives,catalog,evidence,scope){
 const rows=repairTransferPlan(objectives,evidence).filter(row=>row.state!=='waiting');
 const orders=new Map(repairTransferRequest(rows).objectives.map(o=>[o.id,o._transferOrder]));
 return objectivesWithConnectionGaps(objectives,catalog,evidence,scope).map(o=>!o._connectionTargetIds?.length&&orders.has(o.id)?{...o,_transferOrder:orders.get(o.id),_targetOrder:orders.get(o.id)}:o);
}
export function lectureProgressionPlan(targets,evidence){
 const plan=objectivePracticePlan(targets,evidence),byId=new Map(targets.map(o=>[o.id,o]));
 return {...plan,rows:plan.rows.map(row=>{
  const target=byId.get(row.id),order=target._transferOrder||target._targetOrder||row.targetOrder;
  return {...row,targetOrder:order,progressionReason:order===row.targetOrder?row.progressionReason:order==='third-order'?'A source-supported connection is due for a fresh integration retest. This tests transfer; it does not establish mastery.':'Repair or test the targeted connection in a fresh application before integrating it.'};
 })};
}
