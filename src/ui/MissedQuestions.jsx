import { missedQuestionGroups } from '../engine/missedQuestions.js';
import {useState} from 'react';
import * as dismissedStore from '../stores/dismissedMisses.js';
import {useStoreResource} from '../shell/hooks/useStoreResource.js';
export function MissedQuestions({evidence,blockId,lectureId,lectures=[],onReplay,onStudy,busy=false,bare=false,userId=null}) {
 const [page,setPage]=useState(0);
 const dismissed=useStoreResource(dismissedStore,userId);
 const [clearError,setClearError]=useState('');
 const groups=missedQuestionGroups(evidence,{blockId,lectureId,dismissed:dismissed.data});
 const markLearned=async questions=>{setClearError('');try{await dismissedStore.dismiss(userId,questions.map(q=>q.questionId));}catch(e){setClearError(e.message||'Could not save.');}};
 const all=groups.flatMap(group=>group.questions);
 const pageSize=5;
 const currentPage=Math.min(page,Math.max(0,Math.ceil(groups.length/pageSize)-1));
 const visible=groups.slice(currentPage*pageSize,(currentPage+1)*pageSize);
 return <section aria-label="Missed questions from all sources" className={bare?"min-w-0":"my-4 min-w-0 rounded-xl border border-border p-4"}>
  <h3 className={bare?"sr-only":"font-semibold"}>Missed questions · all sources</h3>
  <p className="mt-1 text-xs text-text-3" title={bare?"Original questions from saved quizzes, exams, ExamSoft and homework. A correct answer without help clears the original from this queue.":undefined} hidden={bare}>Original questions from saved quizzes, exams, ExamSoft and homework. A correct answer without help clears the original from this queue; fresh concept recovery is measured separately. Older records without full question text cannot be replayed.</p>
  {clearError&&<p role="alert" className="mt-2 text-sm">⚠ {clearError}</p>}
  {!all.length?<p className="mt-2 text-sm">No replayable unresolved misses in this scope.</p>:<>
  <button disabled={busy} className={bare?"mt-1 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50":"mt-3 rounded border border-border px-3 py-2"} onClick={()=>onReplay(all)}>Redo all missed · {all.length}</button>
  <details className="mt-3 min-w-0"><summary className="cursor-pointer py-2 text-sm">Browse {groups.length} concept groups · {all.length} missed questions</summary>
  {groups.length>pageSize&&<div className="my-2 flex flex-wrap items-center gap-3 text-sm"><span>Groups {currentPage*pageSize+1}–{Math.min((currentPage+1)*pageSize,groups.length)} of {groups.length}</span><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous groups</button><button disabled={(currentPage+1)*pageSize>=groups.length} onClick={()=>setPage(currentPage+1)}>Next groups</button></div>}
  <ul className="mt-3 max-h-[32rem] space-y-3 overflow-y-auto overscroll-contain break-words" aria-label="Missed concept groups">{visible.map(group=><li key={group.key} className="min-w-0 rounded border border-border p-3">
   <p className="text-xs text-text-3">{lectures.find(l=>l.id===group.lectureId)?.lectureTitle || lectures.find(l=>l.id===group.lectureId)?.title || (lectureId?'This lecture':'Lecture not linked')}</p>
   <p className="font-semibold">{group.concept} · {group.questions.length} missed</p>
   <p className="text-xs text-text-3">{group.sources.join(' · ')}</p>
   <div className="mt-2 flex flex-wrap gap-3"><button disabled={busy} onClick={()=>onReplay(group.questions)}>Redo original questions</button>{onStudy&&group.lectureId&&<button onClick={()=>onStudy(group)}>Study concept →</button>}<button disabled={busy} title="Removes these from the redo queue; your accuracy record is unchanged. A new miss brings a question back." onClick={()=>markLearned(group.questions)}>✓ Mark learned</button></div>
   <details className="mt-2 text-sm"><summary>See missed questions</summary><div className="max-h-64 overflow-y-auto">{group.questions.map(q=><div key={q.questionId} className="mt-2"><p>{q.stem}</p><button type="button" disabled={busy} className="text-xs underline" onClick={()=>markLearned([q])}>✓ Mark this one learned</button></div>)}</div></details>
  </li>)}</ul></details></>}
 </section>;
}
