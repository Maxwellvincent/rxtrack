import { useId, useState } from "react";
import { objectiveLearningReport, shortRetestPlan } from "../engine/learningLoop.js";
export function ObjectiveLearningReport({objectives=[],evidence={},records=[],onRetest,onReviewNotes,busy=false}) {
 const detailGroup=useId();
 const [page,setPage]=useState(0);
 const [showSuccessful,setShowSuccessful]=useState(false);
 const allRows=objectiveLearningReport(objectives,evidence,records);
 const missedRows=allRows.filter(row=>row.sessionMisses>0);
 const rows=showSuccessful?allRows:missedRows;
 const currentPage=Math.min(page,Math.max(0,Math.ceil(rows.length/6)-1));
 const visible=rows.slice(currentPage*6,currentPage*6+6);
 const retest=shortRetestPlan(showSuccessful?objectives:objectives.filter(objective=>missedRows.some(row=>row.id===objective.id)),evidence,records);
 if(!records.length || !allRows.length)return null;
 return <section aria-label="Objective learning results" className="rounded-lg border border-border bg-bg-elevated p-4">
 <h3 className="font-bold">What this session showed</h3><p className="mt-1 text-sm text-text-2">Focus on concepts missed this session. Correct answers and longer-term readiness are tracked separately.</p>
 <p className="mt-2 text-sm">{missedRows.length ? `${missedRows.length} objectives to revisit` : "No unresolved misses in this session."}</p>
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
 <p className="mt-2 text-xs">Longer-term readiness: {row.label}. {row.attempts} distinct questions · {row.sessionCount} sessions · {row.taskTypeCount} question types.</p>
 {row.missingRequirements.length>0 && <p className="mt-1 text-xs">For consistent understanding: {row.missingRequirements.join("; ")}.</p>}
 {row.sourceCue && <details className="mt-2 text-xs"><summary className="cursor-pointer">Supporting source excerpt</summary><p className="mt-1">{row.sourceCue}</p></details>}
 </details>
 </li>)}</ul>
 <div className="mt-3 flex flex-wrap gap-2">
 {onReviewNotes && <button type="button" onClick={onReviewNotes} className="rounded border border-border px-3 py-2 text-sm">Review or consolidate notes →</button>}
 {retest.count>0 && onRetest && <button type="button" disabled={busy} onClick={()=>onRetest(retest)} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Fresh {retest.count}-question targeted retest →</button>}
 </div>
 {retest.count>0 && <p className="mt-2 text-xs text-text-2">Review the gaps first, then return for a short retest. It uses fresh questions on up to six unresolved objectives; it does not repeat the whole quiz or guarantee mastery.</p>}
 </section>;
}
