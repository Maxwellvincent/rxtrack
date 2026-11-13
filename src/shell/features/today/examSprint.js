import {repairTransferPlan} from "../../../engine/repairTransfer.js";
import {objectivePracticePlan} from "../../../engine/objectivePractice.js";
import {buildWeakAreaMap} from '../exam/weakAreaMap.js';
import {BPM_BLUEPRINTS,objectiveSubject,SUBJECT_LABELS} from '../exam/bpmBlueprint.js';
/** A transparent prioritization heuristic, not a calibrated score predictor. */
export function examSprintPriorities({blockId,lectures=[],objectives=[],questionStats={},learnerEvidence={},exam=null,availableMinutes=60,now=Date.now()}={}){
 const local=lectures.filter(l=>l.blockId===blockId&&!l.mergedInto&&!/^(SG|TBL|LAB)$/i.test(l.lectureType||''));
 const ids=new Set(local.map(l=>l.id));
 const targets=objectives.filter(o=>ids.has(o.linkedLecId)&&(!o.blockId||o.blockId===blockId));
 const repairRows=repairTransferPlan(targets,learnerEvidence,[],now);
 const practice=new Map(objectivePracticePlan(targets,learnerEvidence).rows.map(row=>[row.id,row]));
 const weights=BPM_BLUEPRINTS[exam];
 const subjectTotals={};
 for(const o of targets){const subject=objectiveSubject(o);if(subject)subjectTotals[subject]=(subjectTotals[subject]||0)+1;}
 const rows=buildWeakAreaMap({lectures:local,objectives:targets,questionStats,learnerEvidence}).filter(r=>r.objectiveTotal>0);
 const ranked=rows.map(row=>{
  const own=targets.filter(o=>o.linkedLecId===row.lectureId);
  const subjects={};for(const o of own){const s=objectiveSubject(o);if(s)subjects[s]=(subjects[s]||0)+1;}
  // Within each blueprint subject use objective share as a proxy for lecture scope,
  // never imply that the school supplied lecture-specific exam weights.
  const known=Object.keys(subjects).filter(s=>weights?.[s]);
  const weight=weights?known.reduce((sum,s)=>sum+(weights[s][0]+weights[s][1])/200*subjects[s]/subjectTotals[s],0):1/Math.max(1,rows.length);
  const accuracy=row.priorityAccuracy;
  const sample=row.recentCount>=3?row.recentCount:row.totalQuestions;
  const confidence=sample/(sample+8);
  const untested=row.objectivesUntested/row.objectiveTotal;
  const weakness=accuracy==null?0:Math.max(0,0.8-accuracy)*confidence;
  const minutes=Math.min(45,Math.max(20,15+Math.min(30,row.strugglingObjectives*3+row.objectivesUntested)));
  const connections=repairRows.filter(item=>item.objective.linkedLecId===row.lectureId&&item.state!=="waiting");
  return {...row,repairConnections:connections.length,repairObjectiveIds:connections.map(item=>item.objective.id),minutes,score:weight*(weakness+untested*.12+Math.min(.12,connections.length*.04))/minutes,subjectLabels:known.map(s=>SUBJECT_LABELS[s]),sample,usesRecent:row.recentCount>=3};
 }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||b.sample-a.sample||String(a.lectureId).localeCompare(String(b.lectureId)));
 const chosen=ranked.slice(0,2);
 const coverage=ranked.find(row=>row.objectivesUntested>0 && row.objectivesUntested/row.objectiveTotal>=0.4);
 if(chosen.length===2 && coverage && !chosen.some(row=>row.objectivesUntested/row.objectiveTotal>=0.4))chosen[1]=coverage;
 const budget=Math.max(10,Math.min(240,Number(availableMinutes)||60));
 const each=Math.floor(budget/Math.max(1,chosen.length));
 return chosen.map(row=>({...row,minutes:Math.min(45,each),questionCount:each>=30?15:each>=20?10:5,action:row.objectivesUntested/row.objectiveTotal>=0.4?'coverage':'repair',focusObjectiveIds:[...new Set([...row.repairObjectiveIds,...targets.filter(o=>o.linkedLecId===row.lectureId && (row.objectivesUntested/row.objectiveTotal>=0.4 ? !practice.get(o.id)?.worked : (practice.get(o.id)?.worked && (!practice.get(o.id)?.latestCorrect || practice.get(o.id)?.state==='struggling')))).map(o=>o.id||o.code).filter(Boolean)])]}));
}
