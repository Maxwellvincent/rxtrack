import {useState} from 'react';
export function LectureDashboard({rows=[],allRows=[],stats={},onStudy,onQuiz,busy,focusedLectureId,rowRef}) {
 const [selected,setSelected]=useState(focusedLectureId || null);
 const [page,setPage]=useState(()=>Math.floor(Math.max(0,rows.findIndex(r=>r.lectureId===focusedLectureId))/6));
 const current=Math.min(page,Math.max(0,Math.ceil(rows.length/6)-1));
 const visible=rows.slice(current*6,current*6+6);
 const active=visible.find(r=>r.lectureId===selected) || visible[0];
 const scoped=allRows.filter(row=>row.total>0);
 const done=scoped.filter(row=>row.done).length;
 const pct=scoped.length?Math.round(done/scoped.length*100):0;
 const total=scoped.reduce((n,r)=>n+r.total,0),covered=scoped.reduce((n,r)=>n+(r.covered||0),0);
 return <section className="lecture-dashboard" aria-label="Lecture completion dashboard">
 <div className="lecture-dashboard-overview">
 <div className="lecture-donut" role="img" aria-label={`${done} of ${scoped.length} lectures completed once`} style={{background:`conic-gradient(#2563eb ${pct}%,#d8dde5 0)`}}><div><strong>{done}/{scoped.length}</strong><span>completed once</span></div></div>
 <div><h3>Finish the first pass. Keep strengthening it.</h3><p>{covered}/{total} lecture objectives reviewed or practiced. Completion means every objective has been encountered at least once; accuracy and mastery are separate.</p><p><strong>✓ Complete</strong> · all objectives covered &nbsp; <strong>○ In progress</strong> · objectives remain</p></div>
 </div>
 <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">Lectures {current*6+1}–{current*6+visible.length} of {rows.length}</strong>{rows.length>6 && <div className="flex gap-2"><button type="button" disabled={current===0} onClick={()=>{setPage(current-1);setSelected(null);}} className="rounded-lg border border-border px-3 py-2 disabled:opacity-40">← Previous six</button><button type="button" disabled={(current+1)*6>=rows.length} onClick={()=>{setPage(current+1);setSelected(null);}} className="rounded-lg border border-border px-3 py-2 disabled:opacity-40">Next six →</button></div>}</div>
 <div className="lecture-dashboard-bars" role="group" aria-label="Six lecture priorities">{visible.map((row,i)=>{
 const coverage=row.total?Math.round((row.covered||0)/row.total*100):0;
 const q=stats[row.lectureId];const accuracy=q?.answered?Math.round(q.correct/q.answered*100):null;
 return <button key={row.lectureId} type="button" aria-pressed={active?.lectureId===row.lectureId} onClick={()=>setSelected(row.lectureId)} ref={row.lectureId===focusedLectureId?rowRef:undefined} className={"lecture-dashboard-bar-card"+(row.lectureId===focusedLectureId?" bg-accent/10":"")}>
 <span className="text-xs font-semibold">#{current*6+i+1} · {row.type} {row.number??''}</span><strong>{row.total?`${coverage}% covered`:"No objectives linked"}</strong>
 <span className="lecture-dashboard-bar" role="img" aria-label={`${row.covered||0} of ${row.total} objectives covered`}><span style={{height:`${coverage}%`}} /></span>
 <span className="lecture-dashboard-title">{row.title}</span><span className="text-xs">{!row.total?'Reference resource':row.done?'✓ First pass complete':`${row.remaining??row.total} objectives left`}</span><span className="text-xs">{accuracy===null?'No graded questions':`${accuracy}% question accuracy`}</span>
 </button>;
 })}</div>
 {active && <div className="lecture-dashboard-selected"><div><strong>{active.type} {active.number??''} · {active.title}</strong><p>{active.covered||0}/{active.total} objectives covered · {active.struggling||0} need repair · {active.mastered||0} ready</p><p>{active.done?'First pass complete. Review and fresh questions still help consolidate it.':'Review remaining objectives, then test the connections.'}</p></div><div className="flex flex-wrap gap-2"><button style={{background:"#2563eb"}} className="rounded-lg px-4 py-3 font-semibold text-white" onClick={()=>onStudy(active.lectureId)}>Study →</button><button disabled={busy===active.lectureId} className="rounded-lg border border-border px-4 py-3 font-semibold" onClick={()=>onQuiz(active)}>Quiz →</button></div></div>}
 </section>;
}
