import {buildWeakAreaMap} from '../exam/weakAreaMap.js';
import {BPM_BLUEPRINTS,objectiveSubject,SUBJECT_LABELS} from '../exam/bpmBlueprint.js';
/** A transparent prioritization heuristic, not a calibrated score predictor. */
export function examSprintPriorities({blockId,lectures=[],objectives=[],questionStats={},learnerEvidence={},exam=null}={}){
 const local=lectures.filter(l=>l.blockId===blockId&&!l.mergedInto&&!/^(SG|TBL|LAB)$/i.test(l.lectureType||''));
 const ids=new Set(local.map(l=>l.id));
 const targets=objectives.filter(o=>ids.has(o.linkedLecId)&&(!o.blockId||o.blockId===blockId));
 const weights=BPM_BLUEPRINTS[exam];
 const subjectTotals={};
 for(const o of targets){const subject=objectiveSubject(o);if(subject)subjectTotals[subject]=(subjectTotals[subject]||0)+1;}
 const rows=buildWeakAreaMap({lectures:local,objectives:targets,questionStats,learnerEvidence}).filter(r=>r.objectiveTotal>0);
 return rows.map(row=>{
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
  const weakness=accuracy==null?0:(1-accuracy)*confidence;
  const minutes=Math.min(45,Math.max(20,15+Math.min(30,row.strugglingObjectives*3+row.objectivesUntested)));
  return {...row,minutes,score:weight*(weakness+untested*.12)/minutes,subjectLabels:known.map(s=>SUBJECT_LABELS[s]),sample,usesRecent:row.recentCount>=3};
 }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||b.sample-a.sample||String(a.lectureId).localeCompare(String(b.lectureId))).slice(0,2);
}
