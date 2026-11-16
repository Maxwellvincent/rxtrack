import { missedQuestionGroups } from '../engine/missedQuestions.js';
export function MissedQuestions({evidence,blockId,lectureId,lectures=[],onReplay,onStudy,busy=false}) {
 const groups=missedQuestionGroups(evidence,{blockId,lectureId});
 const all=groups.flatMap(group=>group.questions);
 return <section aria-label="Missed questions from all sources" className="my-4 rounded-xl border border-border p-4">
  <h3 className="font-semibold">Missed questions · all sources</h3>
  <p className="mt-1 text-xs text-text-3">Original questions from saved quizzes, exams, ExamSoft and homework. A correct answer without help clears the original from this queue; fresh concept recovery is measured separately. Older records without full question text cannot be replayed.</p>
  {!all.length?<p className="mt-2 text-sm">No replayable unresolved misses in this scope.</p>:<>
  <button disabled={busy} className="mt-3 rounded border border-border px-3 py-2" onClick={()=>onReplay(all)}>Redo all missed · {all.length}</button>
  <ul className="mt-3 space-y-3">{groups.map(group=><li key={group.key} className="rounded border border-border p-3">
   <p className="text-xs text-text-3">{lectures.find(l=>l.id===group.lectureId)?.lectureTitle || lectures.find(l=>l.id===group.lectureId)?.title || (lectureId?'This lecture':'Lecture not linked')}</p>
   <p className="font-semibold">{group.concept} · {group.questions.length} missed</p>
   <p className="text-xs text-text-3">{group.sources.join(' · ')}</p>
   <div className="mt-2 flex gap-3"><button disabled={busy} onClick={()=>onReplay(group.questions)}>Redo original questions</button>{onStudy&&group.lectureId&&<button onClick={()=>onStudy(group)}>Study concept →</button>}</div>
   <details className="mt-2 text-sm"><summary>See missed questions</summary>{group.questions.map(q=><p key={q.questionId} className="mt-2">{q.stem}</p>)}</details>
  </li>)}</ul></>}
 </section>;
}
