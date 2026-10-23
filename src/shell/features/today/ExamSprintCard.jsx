import {useState} from 'react';
import {useLectureQuestionStats} from '../../hooks/useLectureQuestionStats.js';
import {examSprintPriorities} from './examSprint.js';
import {BPM_BLUEPRINTS} from '../exam/bpmBlueprint.js';
import {formatLectureLabel} from '../../../lectureTitle.js';
export function ExamSprintCard({context,userId,daysLeft,onStudy,onQuiz,busy}){
 const [exam,setExam]=useState(()=>/^NB\s*1$/i.test(context.blockMeta?.name||'')?'3':'none');
 const stats=useLectureQuestionStats(userId);
 if(daysLeft==null||daysLeft<0||daysLeft>1)return null;
 const rows=examSprintPriorities({...context,questionStats:stats.data||{},exam:exam==='none'?null:exam});
 return <section aria-label="Top two before the exam" className="rounded-xl border-2 border-accent bg-bg-elevated p-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">Top two before the exam</h3><label className="text-sm">Blueprint <select value={exam} onChange={e=>setExam(e.target.value)} className="rounded border border-border bg-bg p-2"><option value="none">No subject weighting</option>{Object.keys(BPM_BLUEPRINTS).map(n=><option key={n} value={n}>BPM 2 Test {n}</option>)}</select></label></div>
  <p className="mt-2 text-sm">An exact test score cannot be predicted reliably from these practice records. These are study priorities, not guaranteed marks gained.</p>
  {stats.loading?<p>Loading practice evidence…</p>:rows.length?<div className="mt-3 grid gap-3 md:grid-cols-2">{rows.map((row,i)=><article key={row.lectureId} className="rounded-lg border border-border p-3">
   <strong>#{i+1} · {formatLectureLabel(row.lecture)}</strong>
   <p className="mt-2">{row.priorityAccuracy==null?'No scored lecture evidence':`${Math.round(row.priorityAccuracy*100)}% ${row.usesRecent?'recent':'recorded'} accuracy · ${row.sample} answers in that sample`} · {row.objectivesUntested} objectives without linked answers.</p>
   <p className="mt-2 text-sm">Suggested {row.minutes}-minute block: review the missed distinctions, then do a fresh application set and read its explanations.</p>
   <div className="mt-3 flex gap-2"><button className="rounded border border-border p-2" onClick={()=>onStudy(row.lectureId)}>Review lecture</button><button disabled={busy===row.lectureId} className="rounded bg-accent p-2 font-semibold text-white" onClick={()=>onQuiz({lec:row.lecture,matchReason:'exam-repair'})}>Practice questions</button></div>
  </article>)}</div>:<p className="mt-3">Not enough linked evidence for this blueprint. Choose the correct test or no subject weighting.</p>}
  {stats.error&&<p role="alert">Some practice totals could not sync; priorities may be incomplete.</p>}
  <details className="mt-3 text-xs text-text-3"><summary>How these are ranked</summary>Recorded weakness, answer-sample size, uncovered objectives and selected subject weights, divided by a rough review-time allowance. Lecture shares within each subject use objective counts as a proxy; actual lecture exam weights are unknown. Recent results are preferred after at least three answers. Outside aggregate scores do not establish lecture or objective knowledge. This is not a calibrated prediction of your test score.</details>
 </section>;
}
