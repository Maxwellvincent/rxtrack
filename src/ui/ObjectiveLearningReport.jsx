import { useState } from "react";
import { objectiveLearningReport, shortRetestPlan } from "../engine/learningLoop.js";
export function ObjectiveLearningReport({objectives=[],evidence={},records=[],onRetest,onReviewNotes,busy=false}) {
 const [page,setPage]=useState(0);
 const rows=objectiveLearningReport(objectives,evidence,records);
 const currentPage=Math.min(page,Math.max(0,Math.ceil(rows.length/6)-1));
 const visible=rows.slice(currentPage*6,currentPage*6+6);
 const retest=shortRetestPlan(objectives,evidence,records);
 if(!records.length || !rows.length)return null;
 return <section aria-label="Objective learning results" className="rounded-lg border border-border bg-bg-elevated p-4">
 <h3 className="font-bold">What this session showed</h3><p className="mt-1 text-sm text-text-2">Every linked answer counts now. Consistent understanding requires fresh evidence across sessions and question types.</p>
 {rows.length>6 && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>Objectives {currentPage*6+1}–{currentPage*6+visible.length} of {rows.length}</span><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)} className="rounded border border-border p-2 disabled:opacity-40">Previous six objectives</button><button type="button" disabled={(currentPage+1)*6>=rows.length} onClick={()=>setPage(currentPage+1)} className="rounded border border-border p-2 disabled:opacity-40">Next six objectives</button></div>}
 <ul className="mt-3 space-y-3">{visible.map(row=><li key={row.id} className="rounded border border-border p-3">
 <p className="text-xs font-semibold">{row.label} · {row.sessionCorrect}/{row.sessionTotal} correct this session</p>
 <p className="mt-1 text-sm font-semibold">{row.text || row.code}</p>
 <p className="mt-1 text-xs text-text-2">{row.attempts} distinct questions · {row.sessionCount} {row.sessionCount===1?"session":"sessions"} · {row.taskTypeCount} question types</p>
 {row.missingRequirements.length>0 && <p className="mt-1 text-xs">Next evidence: {row.missingRequirements.join("; ")}.</p>}
 {row.contrasts.map((contrast,i)=><p key={i} className="mt-1 text-sm">Revisit the distinction: selected {contrast.selected || "your answer"}; keyed answer {contrast.keyed || "see explanation"}.</p>)}
 {row.sourceCue && <details className="mt-2 text-xs"><summary className="cursor-pointer">Supporting source excerpt</summary><p className="mt-1">{row.sourceCue}</p></details>}
 </li>)}</ul>
 <div className="mt-3 flex flex-wrap gap-2">
 {onReviewNotes && <button type="button" onClick={onReviewNotes} className="rounded border border-border px-3 py-2 text-sm">Review or consolidate notes →</button>}
 {retest.count>0 && onRetest && <button type="button" disabled={busy} onClick={()=>onRetest(retest)} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Fresh {retest.count}-question targeted retest →</button>}
 </div>
 {retest.count>0 && <p className="mt-2 text-xs text-text-2">Review the gaps first, then return for a short retest. It uses fresh questions on up to six unresolved objectives; it does not repeat the whole quiz or guarantee mastery.</p>}
 </section>;
}
