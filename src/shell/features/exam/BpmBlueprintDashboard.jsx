import { lectureProgressObjectives } from "../../logic/blockProgress.js";
import { BlueprintSourceCoverage } from "./BlueprintSourceCoverage.jsx";
import { useState } from 'react';
import { BPM_BLUEPRINTS, SUBJECT_LABELS, subjectTargets, objectiveSubject, bpmObjective } from './bpmBlueprint.js';
import * as learnerEvidence from '../../../stores/learnerEvidence.js';
import { useStoreResource } from '../../hooks/useStoreResource.js';
export function compareBlueprintReviewPriority(a, b) {
 const rank = item => item.accuracy == null ? 1 : item.accuracy < .7 ? 0 : 2;
 return rank(a) - rank(b) || (a.accuracy ?? 2) - (b.accuracy ?? 2);
}
export function blueprintReadiness(exam,objectivesByLecture={},evidence={}) {
 const objectives=[...new Map(Object.entries(objectivesByLecture).flatMap(([lectureId,list])=>lectureProgressObjectives(list,evidence).filter(bpmObjective).map(o=>[o.id||o.code,{...o,lectureId}]))).values()];
 return subjectTargets(exam,40).map(row=>{
  const items=objectives.filter(o=>objectiveSubject(o)===row.subject).map(o=>{
   const progress=evidence.objectives?.[o.id] || evidence.objectives?.[o.code];
   const recent=progress?.recent?.slice(-8)||[];
   const accuracy=recent.length ? recent.filter(Boolean).length/recent.length : progress?.attempts ? progress.correct/progress.attempts : o.questionAttempts > 0 ? (o.correctCount || 0)/o.questionAttempts : null;
   return {...o,accuracy,attempts:progress?.attempts||0};
  });
  const practiced=items.filter(o=>o.status!=="untested");
  return {...row,items,practiced:practiced.length,accuracy:practiced.length?practiced.reduce((n,o)=>n+(o.accuracy || 0),0)/practiced.length:null,
   weak:practiced.filter(o=>o.accuracy!=null && o.accuracy<.7).length,untested:items.length-practiced.length};
 });
}
export function BpmBlueprintDashboard({userId,blockId,objectivesByLecture,lectures=[],onStart,onReview}) {
 const [exam,setExam]=useState('3');
 const resource=useStoreResource(learnerEvidence,userId);
 const rows=blueprintReadiness(exam,objectivesByLecture,resource.data||{});
 return <section className="mb-5 rounded-xl border border-border bg-panel p-4" aria-label="BPM 2 exam blueprint dashboard">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">BPM 2 exam preparation</h3>
   <label className="text-sm">Test <select aria-label="Dashboard test" className="ml-2 rounded border border-border bg-bg p-2" value={exam} onChange={e=>setExam(e.target.value)}>{Object.keys(BPM_BLUEPRINTS).map(n=><option key={n} value={n}>{n}</option>)}</select></label></div>
  <p className="mt-2 text-sm text-text-2">Current block only, using its linked lecture objectives. Other blocks are included only in comprehensive practice. Bars show average objective accuracy; exam weight sets the practice mix.</p>
  <p className="mt-2 text-xs text-text-2">Untested means no recorded, non-excluded question answer linked to that objective. Reviewing notes alone is tracked separately. These cards show only the selected test’s subjects.</p>
  {resource.loading && <p role="status">Syncing your practice history…</p>}
  <div className="mt-4 grid gap-3 sm:grid-cols-3">
   {rows.map(row=><div key={row.subject} className="rounded-lg border border-border bg-bg p-3">
    <div className="flex h-40 items-end justify-center"><div className="flex h-full w-16 flex-col justify-end text-center"><strong>{row.accuracy==null?'No data':`${Math.round(row.accuracy*100)}%`}</strong><div aria-label={`${SUBJECT_LABELS[row.subject]} average objective accuracy`} className={`mt-1 w-full rounded-t ${row.accuracy!=null&&row.accuracy<.7?'bg-bad':'bg-accent'}`} style={{height:row.accuracy==null?'2px':`${Math.max(2,row.accuracy*100)}%`}} /></div></div>
    <h4 className="mt-2 font-bold">{SUBJECT_LABELS[row.subject]}</h4><p className="text-sm">{row.range.join('–')}% of test · {row.practiced}/{row.items.length} objectives practiced</p>
    <p className="mt-1 text-sm text-text-2">{row.weak} below 70% · {row.untested} untested</p>
    <details className="mt-2 text-sm"><summary className="cursor-pointer">Review priorities</summary><p className="mt-2 text-xs text-text-2">Lowest recorded objective accuracy first, then untested material.</p><ul className="mt-2 space-y-2">{[...row.items].sort(compareBlueprintReviewPriority).slice(0,8).map(o=><li key={o.id||o.code}><button type="button" onClick={()=>onReview?.(o.lectureId)} className="text-left underline">{o.objective||o.text||o.description||o.code||o.id}</button><span className="block text-xs text-text-2">{lectures.find(lecture => lecture.id === o.lectureId)?.lectureTitle || "Linked lecture"} · {o.code || o.objectiveCode || "No source code"}</span><span className="block text-text-2">{o.accuracy==null?'Untested':`${Math.round(o.accuracy*100)}% · ${o.attempts} linked answers`}</span></li>)}</ul></details>
   </div>)}
  </div>
  <p className="mt-3 text-xs text-text-3">Each practiced objective has equal weight here. Uses its last 8 linked answers when available; this is practice accuracy, not a predicted exam score or mastery claim. Unclassified objectives are shown in exam settings.</p>
  <BlueprintSourceCoverage blockId={blockId} userId={userId} exam={exam} objectivesByLecture={objectivesByLecture} lectures={lectures} />
  <button type="button" className="mt-3 rounded-lg bg-accent px-4 py-2 font-bold text-white" onClick={()=>onStart?.(Number(exam))}>Practice for Test {exam}</button>
 </section>;
}
