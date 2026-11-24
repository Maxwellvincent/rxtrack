import {useState} from 'react';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import * as validationStore from '../../../stores/readinessValidation.js';
import * as ratingsStore from '../../../stores/questionRatings.js';
import {readinessSnapshot,randomAuditSample,nbExam2Scope} from '../../../engine/readinessValidation.js';
import {auditQuestionAccuracy} from '../../../engine/questionAccuracyAudit.js';
import {fetchLectureContent} from '../../../firebaseData.js';
import {lectureTextFrom} from '../lectures/lectureStudy.js';
import {questionPreparationDeps} from '../../../questionPreparation.js';
import {callAIJSON} from '../../../aiClient.js';
import {withDeadline} from '../../../asyncDeadline.js';
import {QuestionQualityRating} from '../../../ui/QuestionQualityRating.jsx';
import {reconcileQuestionQuality} from '../../../stores/questionQualityReconciliation.js';
const pct=value=>value==null?'Not estimated':`${value.toFixed(1)}%`;
export function ReadinessValidation({userId,blockId,blockName='',lectures=[],objectives=[],evidence={},ratings={},sessions=[],loading=false,onRefresh}){
 const resource=useStoreResource(validationStore,userId);
 const [name,setName]=useState('Next school test'),[date,setDate]=useState(''),[selected,setSelected]=useState(null),[weights,setWeights]=useState({});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [subjectWeights,setSubjectWeights]=useState(null);
 const [nbPlan,setNbPlan]=useState(false);
 const scoped=lectures.filter(l=>l.blockId===blockId),ids=(selected||scoped.map(l=>l.id)).filter(id=>scoped.some(l=>l.id===id));
 const snapshot=readinessSnapshot({blockId,lectureIds:ids,objectives,sessions,evidence,ratings,weights,subjectWeights});
 const savedSnapshots=(resource.data?.snapshots||[]).filter(s=>s.blockId===blockId);
 const comparisons=savedSnapshots.filter(s=>Number.isFinite(s.actual?.errorPoints));
 const meanError=comparisons.length?comparisons.reduce((sum,s)=>sum+Math.abs(s.actual.errorPoints),0)/comparisons.length:null;
 const run=async work=>{setBusy(true);setMessage('');try{await work();}catch(error){setMessage(error.message||'Could not save.');}finally{setBusy(false);}};
 const blocked=busy||loading||resource.loading||!!resource.error||!userId;
 async function audit(){
  const journal=(evidence.learningJournal||[]).filter(e=>e.blockId===blockId&&e.learningContext?.stem&&ids.includes(e.lectureId));
  const answered=sessions.filter(s=>s.blockId===blockId).flatMap(s=>{const seen=new Set((s.status==='submitted'?s.answers||[]:s.checkpointAnswers||[]).filter(a=>a.value!=null).map(a=>a.questionId));return (s.questions||[]).filter(q=>seen.has(q.questionId)&&ids.includes(q.lectureId));});
  const questions=randomAuditSample([...journal.map(e=>({...e.learningContext,correct:e.learningContext.correctLetter,questionKey:e.questionKey,questionId:e.questionKey,lectureId:e.lectureId,objectiveIds:e.objectiveIds})),...answered],10);
  if(!questions.length)throw new Error('No saved answered questions are available in this lecture scope.');
  const provider=await questionPreparationDeps(callAIJSON);
  const sourceCache=new Map(),results=[];
  for(const question of questions){
   setMessage(`Checking question ${results.length+1}/${questions.length} against its lecture…`);
   let result;
   try{
    if(!sourceCache.has(question.lectureId)){const local=scoped.find(l=>l.id===question.lectureId);const remote=await withDeadline(()=>fetchLectureContent(userId,question.lectureId),15000,undefined,'Lecture source read');sourceCache.set(question.lectureId,lectureTextFrom(remote)||lectureTextFrom(local));}
    result=await auditQuestionAccuracy(question,{source:sourceCache.get(question.lectureId),objectives:objectives.filter(o=>o.linkedLecId===question.lectureId),callAIJSON:provider.reviewAIJSON});
    if(result.status==='needs-review'){
     const onlyAlignment=result.issues.length===1&&result.issues[0]==='Lecture objective alignment not verified';
     await ratingsStore.rateQuestionAwait(userId,question,{sourceIssue:result.issueCategory||'invalid-choices',sourceNote:`Accuracy audit flagged this item for review: ${result.issues.join('; ')}`,excludeFromPerformance:!onlyAlignment,excludeFromObjectives:true});
     await reconcileQuestionQuality(userId,question);
    }
   }catch(error){result={status:'unverified',issues:[error.message||'Audit could not finish'],humanVerified:false};}
   results.push({questionId:question.questionId||question.questionKey||null,questionKey:question.questionKey||null,poolId:question.poolId||null,sourceFile:question.sourceFile||null,lectureId:question.lectureId||null,stem:question.stem,choices:question.choices,correct:question.correct,...result});
  }
  await validationStore.saveAudit(userId,{id:crypto.randomUUID(),blockId,createdAt:Date.now(),sampling:'Random sample of retained answered questions only; untouched assessments excluded.',results});
  setMessage('Audit saved. AI-passed items still need independent human review. Flagged items are protected pending review; an objective-only mismatch keeps its score but cannot establish objective mastery.');
 }
 return <section aria-label="Accuracy and 80 percent goal" className="space-y-4">
  <h2 className="text-xl font-bold">Accuracy & 80% goal</h2>
  {/\bNB\s*2\b/i.test(blockName)&&<button disabled={blocked} className="rounded border border-border p-2" onClick={()=>{
   setName('NB Exam 2');setDate('2026-11-16');setSelected(nbExam2Scope(lectures,blockId).filter(id=>objectives.some(o=>(o.linkedLecId||o.lectureId)===id)));setSubjectWeights({neuroscience:67.5,behavioral:32.5});setNbPlan(true);
  }}>Use NB Exam 2 · Nov 16 · lectures 27–54 + block DLAs</button>}
  {nbPlan&&<p className="text-sm">Subject weighting: Neuroscience 67.5% / Behavioral Science 32.5% (midpoints of your 65–70% / 30–35% ranges). Reported coverage: 116/142 and 31/52; these are coverage counts, not scores. Scope is provisional pending the school syllabus. Test time was not supplied; only the date is recorded.</p>}
  {subjectWeights&&<div className="text-sm">{snapshot.bySubject.map(s=><p key={s.subject}>{s.subject}: {s.correct}/{s.total} fresh timed · {Math.round(s.coverage*100)}% fresh objective coverage · weight {s.weight}%</p>)}<p>A numeric subject-weighted proxy also requires 70% fresh objective coverage in each subject. Mixed or unclassified items cannot fill a missing subject.</p></div>}
  <p className="text-sm">Save your estimate before the test, then enter the actual result. The 80% goal is verified by your school score. Practice accuracy is a provisional proxy, not a probability of passing.</p>
  {(resource.error||!userId)&&<p role="alert">{resource.error?.message||'Sign in to save forecasts and audits.'}</p>}
  <details className="rounded border border-border p-3"><summary>Test lecture scope and school weights · {ids.length} lectures</summary><p className="text-xs">Default: equal weight per lecture. Use the school blueprint weights when known.</p><div className="max-h-64 overflow-y-auto">{scoped.map(l=><label key={l.id} className="my-2 flex flex-wrap gap-2 text-sm"><input type="checkbox" checked={ids.includes(l.id)} onChange={e=>setSelected(e.target.checked?[...ids,l.id]:ids.filter(id=>id!==l.id))}/>{l.lectureTitle||l.title||l.id}<input aria-label={`Weight ${l.id}`} className="w-20 rounded border p-1" type="number" min="0.1" step="0.1" value={weights[l.id]||1} onChange={e=>setWeights({...weights,[l.id]:e.target.value})}/></label>)}</div></details>
  <article className="rounded border border-border p-4"><h3 className="font-bold">Current evidence · last 30 days</h3><p>Fresh timed questions: {snapshot.total} · {snapshot.sessionCount} sessions · objective coverage {Math.round(snapshot.objectiveCoverage*100)}%</p><p>Weighted practice accuracy: {pct(snapshot.practicePercent)} · provisional estimate: {pct(snapshot.estimatePercent)}</p><p className="text-xs">A numeric proxy requires at least 30 fresh timed questions, two sessions, 70% objective coverage and evidence from every selected lecture. These are minimum evidence rules, not validated predictive thresholds. Repeated, assisted, recovered, incomplete and flagged items are excluded. Untimed practice does not enter the proxy.</p><details><summary>Exclusion counts and lecture evidence</summary><p>{Object.entries(snapshot.excluded).map(([key,n])=>`${key}: ${n}`).join(' · ')}</p>{snapshot.byLecture.map(l=><p key={l.id}>{scoped.find(item=>item.id===l.id)?.lectureTitle||l.id}: {l.correct}/{l.total} · weight {l.weight}</p>)}</details>
  <div className="mt-3 flex flex-wrap gap-2"><input aria-label="School test name" value={name} onChange={e=>setName(e.target.value)} className="rounded border p-2"/><input aria-label="Scheduled test date" type="date" value={date} onChange={e=>setDate(e.target.value)} className="rounded border p-2"/><button disabled={blocked} onClick={()=>run(async()=>{await validationStore.freezeSnapshot(userId,{...snapshot,name,testDate:date,dateOnly:true,testAt:new Date(`${date}T23:59:59`).getTime(),...(nbPlan?{scopeNotes:'NB 2 lectures 27–54 plus block DLAs with linked objectives; provisional user-reported scope',reportedCoverage:{neuroscience:{practiced:116,total:142},behavioral:{practiced:31,total:52}},weightBasis:'User-supplied range midpoints; neuroscience 65–70%, behavioral 30–35%'}:{}),auditSummary:(resource.data?.audits||[]).filter(a=>a.blockId===blockId).map(a=>({id:a.id,createdAt:a.createdAt,total:a.results.length,passed:a.results.filter(r=>r.status==='ai-check-passed').length}))});setMessage('Pre-test snapshot saved and locked. Future practice cannot change it.');})}>Save pre-test snapshot</button></div><p className="mt-1 text-xs">Save only before starting the school test. The date-only schedule does not specify an exam start time.</p></article>
  <article className="rounded border border-border p-4"><h3 className="font-bold">Question accuracy audit</h3><p className="text-sm">Randomly checks up to 10 retained answered questions against the original lecture: choices, key-hidden solve, unique answer, objective alignment and explanation. This is an AI screen, not independent human certification. Original questions are never rewritten.</p><button disabled={blocked} onClick={()=>run(audit)} className="mt-2 rounded border p-2">Audit a random sample</button></article>
  {message&&<p role="status" className="text-sm">{message}</p>}
  <p className="text-sm">Compared school tests: {comparisons.length}{meanError!=null?` · average absolute estimate error: ${meanError.toFixed(1)} percentage points`:''}. More independent tests are needed to assess prediction reliability.</p>
  <div className="max-h-[40rem] space-y-3 overflow-y-auto">{savedSnapshots.slice().reverse().map(s=><SavedEstimate key={s.id} snapshot={s} disabled={blocked} onSave={actual=>run(async()=>{await validationStore.saveActual(userId,s.id,actual);setMessage('Actual school score saved against the original estimate.');})}/>)}</div>
  <details className="rounded border border-border p-3"><summary>Saved accuracy audits</summary>
   <div className="max-h-96 space-y-3 overflow-y-auto">{(resource.data?.audits||[]).filter(a=>a.blockId===blockId).slice().reverse().map(a=><article key={a.id}>
    <p>{new Date(a.createdAt).toLocaleString()} · {a.results.filter(r=>r.status==='ai-check-passed').length}/{a.results.length} AI checks passed</p><p className="text-xs">{a.sampling}</p>
    {a.results.map((r,i)=><details key={i}><summary>{r.status} · {r.stem.slice(0,100)}</summary>
     <p>{r.stem}</p><p>{Object.entries(r.choices||{}).map(([k,v])=>`${k}: ${typeof v==='string'?v:JSON.stringify(v)}`).join(' · ')}</p>
     <p>Stored key: {r.correct} · blind answer: {r.solverAnswer||'unverified'}</p><p>{r.issues.join('; ')}</p>
     {(r.sourceQuotes||[]).map((q,j)=><blockquote key={j}>{q}</blockquote>)}
     <p>{Object.entries(r.choiceReasons||{}).map(([k,v])=>`${k}: ${v}`).join(' · ')}</p>
     <p>Verify this evidence and all alternatives against the original lecture or a qualified reviewer. Use the report controls to correct a flag after checking the source.</p>
     <QuestionQualityRating userId={userId} question={r}/>
    </details>)}
   </article>)}</div>
  </details>
  {onRefresh&&<button onClick={onRefresh} disabled={busy}>Refresh saved session evidence</button>}
 </section>;
}
function SavedEstimate({snapshot:s,disabled,onSave}){
 const [correct,setCorrect]=useState(''),[total,setTotal]=useState(''),[taken,setTaken]=useState('');
 return <article className="rounded border border-border p-4"><h3 className="font-bold">{s.name}</h3>
  <p>Locked {new Date(s.createdAt).toLocaleString()} · scheduled {s.dateOnly?`${s.testDate} (date only)`:new Date(s.testAt).toLocaleString()}</p>
  {s.subjectWeights&&<p>School subject weights: {Object.entries(s.subjectWeights).map(([subject,weight])=>`${subject} ${weight}%`).join(' · ')}</p>}
  <p>Pre-test estimate: {pct(s.estimatePercent)} · goal {s.goal}% · {s.total} fresh timed questions</p>
  {s.actual?<><p>Actual school score: {s.actual.correct}/{s.actual.total} · {pct(s.actual.percent)} · {s.actual.goalMet?'80% goal met':'Below 80% goal'}</p><p>{s.actual.errorPoints==null?'No numeric estimate was available for this test.':`Actual minus estimate: ${s.actual.errorPoints.toFixed(1)} percentage points.`} One test is a calibration observation, not proof of predictive accuracy.</p></>:<div className="mt-2 flex flex-wrap gap-2"><input aria-label={`Correct ${s.id}`} placeholder="Correct" type="number" min="0" value={correct} onChange={e=>setCorrect(e.target.value)} className="w-24 rounded border p-2"/><input aria-label={`Total ${s.id}`} placeholder="Total" type="number" min="1" value={total} onChange={e=>setTotal(e.target.value)} className="w-24 rounded border p-2"/><input aria-label={`Taken at ${s.id}`} type="datetime-local" value={taken} onChange={e=>setTaken(e.target.value)} className="rounded border p-2"/><button disabled={disabled||!correct||!total||!taken} onClick={()=>onSave({correct:Number(correct),total:Number(total),takenAt:new Date(taken).getTime()})}>Save actual school result</button></div>}
 </article>;
}
