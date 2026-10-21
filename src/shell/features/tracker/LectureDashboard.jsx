import {useState} from 'react';
export function LectureDashboard({rows=[],allRows=[],stats={},onStudy,onQuiz,busy,focusedLectureId,rowRef}) {
 const [selected,setSelected]=useState(focusedLectureId || null);
 const active=rows.find(r=>r.lectureId===selected) || rows[0];
 const scoped=allRows.filter(row=>row.total>0);
 const done=scoped.filter(row=>row.done).length;
 const pct=scoped.length?Math.round(done/scoped.length*100):0;
 const total=scoped.reduce((n,r)=>n+r.total,0),covered=scoped.reduce((n,r)=>n+(r.covered||0),0);
 return <section className="lecture-dashboard" aria-label="Lecture completion dashboard">
 <div className="lecture-dashboard-overview">
 <div className="lecture-donut" role="img" aria-label={`${done} of ${scoped.length} lectures completed once`} style={{background:`conic-gradient(#2563eb ${pct}%,#d8dde5 0)`}}><div><strong>{done}/{scoped.length}</strong><span>completed once</span></div></div>
 <div><h3>Finish the first pass. Keep strengthening it.</h3><p>{covered}/{total} lecture objectives reviewed or practiced. Completion means every objective has been encountered at least once; accuracy and mastery are separate.</p><p><strong>✓ Complete</strong> · all objectives covered &nbsp; <strong>○ In progress</strong> · objectives remain</p></div>
 </div>
 <div className="lecture-dashboard-bars" role="group" aria-label="Six lecture priorities">{rows.slice(0,6).map((row,i)=>{
 const coverage=row.total?Math.round((row.covered||0)/row.total*100):0;
 const q=stats[row.lectureId];const accuracy=q?.answered?Math.round(q.correct/q.answered*100):null;
 return <button key={row.lectureId} type="button" aria-pressed={active?.lectureId===row.lectureId} onClick={()=>setSelected(row.lectureId)} ref={row.lectureId===focusedLectureId?rowRef:undefined} className={"lecture-dashboard-bar-card"+(row.lectureId===focusedLectureId?" bg-accent/10":"")}>
 <span className="text-xs font-semibold">#{i+1} · {row.type} {row.number??''}</span><strong>{coverage}% covered</strong>
 <span className="lecture-dashboard-bar" role="img" aria-label={`${row.covered||0} of ${row.total} objectives covered`}><span style={{height:`${coverage}%`}} /></span>
 <span className="lecture-dashboard-title">{row.title}</span><span className="text-xs">{row.done?'✓ First pass complete':`${row.remaining??row.total} objectives left`}</span><span className="text-xs">{accuracy===null?'No graded questions':`${accuracy}% question accuracy`}</span>
 </button>;
 })}</div>
 {active && <div className="lecture-dashboard-selected"><div><strong>{active.type} {active.number??''} · {active.title}</strong><p>{active.covered||0}/{active.total} objectives covered · {active.struggling||0} need repair · {active.mastered||0} ready</p><p>{active.done?'First pass complete. Review and fresh questions still help consolidate it.':'Review remaining objectives, then test the connections.'}</p></div><div className="flex flex-wrap gap-2"><button style={{background:"#2563eb"}} className="rounded-lg px-4 py-3 font-semibold text-white" onClick={()=>onStudy(active.lectureId)}>Study →</button><button disabled={busy===active.lectureId} className="rounded-lg border border-border px-4 py-3 font-semibold" onClick={()=>onQuiz(active)}>Quiz →</button></div></div>}
 </section>;
}
