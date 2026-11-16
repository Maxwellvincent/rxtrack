import {usePlanningClock} from "../shell/hooks/usePlanningClock.js";
import {repairTransferPlan,repairTransferRequest} from "../engine/repairTransfer.js";
import { useId, useState, useMemo } from "react";
import { objectiveLearningReport, shortRetestPlan } from "../engine/learningLoop.js";
function groupedRepairRows(rows) {
 const groups=new Map();
 for(const row of rows){
  const key=JSON.stringify([row.objective.linkedLecId||row.objective.lectureId,row.concept]);
  const previous=groups.get(key);
  if(!previous)groups.set(key,{...row,count:1});
  else groups.set(key,{...(row.state==='transfer'?row:previous),count:previous.count+1});
 }
 return [...groups.values()];
}
export function ObjectiveLearningReport({objectives=[],evidence={},records=[],onRetest,onReviewNotes,busy=false}) {
 const planningTime=usePlanningClock(evidence.updatedAt||records.at(-1)?.at||records.at(-1)?.ts);
 const detailGroup=useId();
 const [page,setPage]=useState(0);
 const [showSuccessful,setShowSuccessful]=useState(false);
 const [retestCount,setRetestCount]=useState(10);
 const transferRows=useMemo(()=>repairTransferPlan(objectives,evidence,records,planningTime),[objectives,evidence,records,planningTime]);
 const currentEventIds=useMemo(()=>new Set(records.map(record=>record.eventId).filter(Boolean)),[records]);
 const currentRows=transferRows.filter(row=>row.anchor?.eventId&&currentEventIds.has(row.anchor.eventId));
 const currentTransferRows=groupedRepairRows(currentRows);
 const historicalTransferRows=groupedRepairRows(transferRows.filter(row=>!currentRows.includes(row)));
 const transferRequest=repairTransferRequest(transferRows);
 const allRows=useMemo(()=>objectiveLearningReport(objectives,evidence,records),[objectives,evidence,records]);
 const missedRows=allRows.filter(row=>row.sessionMisses>0);
 const touchedObjectiveIds=new Set(records.flatMap(record=>record.objectiveIds||[]));
 const notSampledCount=Math.max(0,objectives.length-touchedObjectiveIds.size);
 const lifetimeRows=useMemo(()=>objectiveLearningReport(objectives,evidence,[]),[objectives,evidence]);
 const neverPracticedCount=lifetimeRows.filter(row=>!row.worked).length;
 const rows=showSuccessful?allRows:missedRows;
 const currentPage=Math.min(page,Math.max(0,Math.ceil(rows.length/6)-1));
 const visible=rows.slice(currentPage*6,currentPage*6+6);
 const concepts=[...new Map(missedRows.flatMap(row=>{
  const topics=row.contrasts.map(item=>item.topic).filter(Boolean);
  return (topics.length?topics:[row.text || row.code || "Review this objective"]).map(text=>[text.toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),text]);
 })).values()];
 const retest=shortRetestPlan(showSuccessful?objectives:objectives.filter(objective=>missedRows.some(row=>row.id===objective.id)),evidence,records);
 if((!records.length || !allRows.length)&&!transferRows.length)return null;
 return <section aria-label="Objective learning results" className="rounded-lg border border-border bg-bg-elevated p-4">
 <div className="mb-4 rounded border border-border p-3" aria-label="Current session evidence">
 <h3 className="font-bold">Current session</h3>
 <p className="mt-1 text-sm">{missedRows.length?`${missedRows.length} objective${missedRows.length===1?'':'s'} with a missed answer.`:'No missed objectives in this session.'}</p>
 {notSampledCount>0&&<p className="mt-1 text-xs text-text-2"><strong>Coverage note:</strong> This exam tested {touchedObjectiveIds.size} of {objectives.length} objectives. The other {notSampledCount} were not tested, so they are not being labeled strong or weak.{neverPracticedCount>0?` Across all saved work, ${neverPracticedCount} objectives have not been tested yet.`:''}</p>}
 </div>
 {transferRows.length>0&&<div className="mb-4" aria-label="Repair and transfer">
 {currentTransferRows.length>0&&<><h3 className="font-bold">Current-session repair</h3><ul className="mt-2 space-y-1 text-sm">{currentTransferRows.slice(0,6).map(row=><li key={row.id}>{row.concept} · {row.state==='transfer'?'Fresh application next':row.state==='due'?'Independent retest due':`Retest ${new Date(row.dueAt).toLocaleDateString()}`}</li>)}</ul></>}
 {historicalTransferRows.length>0&&<><h3 className={`${currentTransferRows.length?'mt-4 ':''}font-bold`}>Historical repair queue</h3><p className="mt-1 text-xs text-text-2">Unresolved connections from earlier questions, separate from this session's result.</p><ul className="mt-2 space-y-1 text-sm">{historicalTransferRows.slice(0,6).map(row=><li key={row.id}>{row.concept} · {row.state==='transfer'?'Fresh application next':row.state==='due'?'Independent retest due':`Retest ${new Date(row.dueAt).toLocaleDateString()}`}</li>)}</ul></>}
 {transferRequest.count>0&&onRetest&&<div className="mt-3"><TargetedRetestControls count={retestCount} onCount={setRetestCount} disabled={busy} onLaunch={()=>onRetest({...transferRequest,count:retestCount})} /></div>}
 <p className="mt-2 text-xs text-text-2">Use Help Me Reason if a connection is missing. Guided answers stay assisted; fresh independent application is checked separately, then retested after at least a day.</p>
 </div>}
 {!transferRows.length&&<>
 <h3 className="font-bold">Concepts to review</h3>
 <p className="mt-1 text-sm text-text-2">From unresolved misses in this session.</p>
 {concepts.length ? <ul aria-label="Review concepts" className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">{concepts.map(concept=><li key={concept} className="flex gap-2 text-sm"><span aria-hidden="true">↻</span><span>{concept}</span></li>)}</ul> : <p className="mt-2 text-sm">No unresolved misses in this session.</p>}
 </>}
 <details className="mt-4 text-sm"><summary className="cursor-pointer">Previous missed questions and objective details</summary>
 <button type="button" className="mt-2 text-sm underline" onClick={()=>{setShowSuccessful(!showSuccessful);setPage(0);}}>{showSuccessful?"Show misses only":"Show all practiced objectives"}</button>
 {rows.length>6 && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>Objectives {currentPage*6+1}–{currentPage*6+visible.length} of {rows.length}</span><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)} className="rounded border border-border p-2 disabled:opacity-40">Previous six objectives</button><button type="button" disabled={(currentPage+1)*6>=rows.length} onClick={()=>setPage(currentPage+1)} className="rounded border border-border p-2 disabled:opacity-40">Next six objectives</button></div>}
 <ul className="mt-3 space-y-3">{visible.map(row=><li key={row.id} className="rounded border border-border p-3">
 <p className="text-xs font-semibold">{row.sessionMisses>0?"Revisit":"Answered correctly"} · {row.sessionCorrect}/{row.sessionTotal} correct this session</p>
 <p className="mt-1 text-sm font-semibold">{row.text || row.code}</p>
 {row.contrasts.length>0 && <p className="mt-1 text-sm text-text-2">Concepts: {[...new Set(row.contrasts.map(item=>item.topic).filter(Boolean))].slice(0,3).join(" · ") || "Review the distinctions within this objective."}</p>}
 <details name={detailGroup} className="mt-2 text-sm"><summary className="cursor-pointer">See questions and answer details</summary>
 {row.contrasts.map((item,i)=><div key={i} className="mt-3 border-t border-border pt-2">
 {item.stem ? <><p>{item.stem}</p><ul>{Object.entries(item.choices || {}).map(([letter,text])=><li key={letter}>{letter}. {text}</li>)}</ul></> : <p>Full question text was not retained in this older summary.</p>}
 <p>Your answer: {item.selected || "Not recorded"}</p><p>Keyed answer: {item.keyed || "Not recorded"}</p>
 {item.explanation && <p className="mt-1">{item.explanation}</p>}
 </div>)}
 <p className="mt-2 text-xs">Practice evidence: {row.label}. {row.attempts} distinct questions · {row.sessionCount} sessions · {row.taskTypeCount} question types.</p>
 {row.readinessBasis==="recent-fresh-recovery" && <p className="mt-1 text-xs">Recent recovery: {row.recovery.correct}/{row.recovery.count} fresh questions correct across spaced sessions, including verified application. Lifetime accuracy remains {Math.round(row.accuracy*100)}%; exam readiness is not established.</p>}
 {row.missingRequirements.length>0 && <p className="mt-1 text-xs">For consistent understanding: {row.missingRequirements.join("; ")}.</p>}
 {row.sourceCue && <details className="mt-2 text-xs"><summary className="cursor-pointer">Supporting source excerpt</summary><p className="mt-1">{row.sourceCue}</p></details>}
 </details>
 </li>)}</ul>
 </details>
 <div className="mt-3 flex flex-wrap gap-2">
 {onReviewNotes && <button type="button" onClick={onReviewNotes} className="rounded border border-border px-3 py-2 text-sm">Review or consolidate notes →</button>}
 {!transferRows.length && retest.count>0 && onRetest && <TargetedRetestControls count={retestCount} onCount={setRetestCount} disabled={busy} onLaunch={()=>onRetest({...retest,count:retestCount})} />}
 </div>
 {!transferRows.length && retest.count>0 && <p className="mt-2 text-xs text-text-2">Review the gaps first, then choose a fresh set. Questions target the missed objectives with new clinical evidence and distractors; they do not repeat the original quiz or guarantee mastery.</p>}
 </section>;
}

function TargetedRetestControls({count,onCount,onLaunch,disabled}) {
 return <div aria-label="Targeted retest size"><p className="mb-2 text-xs font-semibold text-text-2">Fresh targeted questions</p><div className="flex flex-wrap gap-2">{[5,10,20,30].map(value=><button key={value} type="button" aria-pressed={count===value} onClick={()=>onCount(value)} className={`min-h-10 rounded border px-3 py-2 text-sm font-semibold ${count===value?'border-accent bg-accent/15 text-text-1':'border-border text-text-2'}`}>{value}</button>)}<button type="button" disabled={disabled} onClick={onLaunch} className="min-h-10 rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Start {count}-question targeted retest →</button></div></div>;
}
