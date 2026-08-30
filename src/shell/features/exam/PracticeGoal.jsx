import {useState} from 'react';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import {practiceGoalStore} from '../../../stores/practiceGoal.js';
import {questionProgress} from './questionProgress.js';

export function PracticeGoal({userId,blockId,studyAnswers,sessions}) {
 const resource=useStoreResource(practiceGoalStore,userId);
 const goal=resource.data?.[blockId];
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const progress=goal?questionProgress(studyAnswers,sessions,goal):null;
 async function save(next){setBusy(true);setNotice('');try{await practiceGoalStore.write(userId,{...practiceGoalStore.read(userId),[blockId]:next});setNotice('Goal saved.');}catch(e){setNotice(`Could not save: ${e.message}`);}finally{setBusy(false);}}
 return <div className="mt-3 border-t border-border pt-3">
  {goal && <><p className="text-sm font-semibold">Personal goal · {goal.start} – {goal.end}: {progress.answered.toLocaleString()} / {goal.target.toLocaleString()}</p><progress className="mt-2 h-3 w-full accent-accent" max={goal.target} value={Math.min(goal.target,progress.answered)} aria-label="Personal question goal"/><p className="text-sm">{Math.max(0,goal.target-progress.answered)} remaining · {Math.round(progress.answered/goal.target*100)}% of goal</p></>}
  <details><summary className="cursor-pointer py-2 text-sm">{goal?'Edit personal goal':'Set an optional personal goal'}</summary>
   <form key={JSON.stringify(goal)} className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const next={target:Number(form.get('target')),start:String(form.get('start')),end:String(form.get('end'))};if(!Number.isInteger(next.target)||next.target<1||next.start>next.end){setNotice('Choose a positive target and an end date after the start date.');return;}save(next);}}>
    <label className="text-sm">Questions<input className="block w-28 rounded border border-border bg-panel p-2" name="target" type="number" min="1" required defaultValue={goal?.target||1000}/></label>
    <label className="text-sm">From<input className="block rounded border border-border bg-panel p-2" name="start" type="date" required defaultValue={goal?.start}/></label>
    <label className="text-sm">Through<input className="block rounded border border-border bg-panel p-2" name="end" type="date" required defaultValue={goal?.end}/></label>
    <button className="rounded border border-border p-2" disabled={busy||resource.loading||!!resource.error}>Save goal</button>
    {goal&&<button type="button" className="rounded border border-border p-2" disabled={busy||resource.loading||!!resource.error} onClick={()=>save(null)}>Remove goal</button>}
   </form><p className="mt-2 text-xs text-text-3">Includes lecture/objective quizzes, school practice and integrated exams in this block. Session answers use the submission date. This goal does not repeat automatically.</p>
  </details>{notice&&<p role="status">{notice}</p>}{resource.error&&<p role="alert">Goal settings could not sync.</p>}
 </div>;
}
