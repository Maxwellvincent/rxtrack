import * as completionStore from '../../../stores/completion.js';
import {completionKey} from '../../logic/completionLog.js';
import {lectureReviewStats} from './lectureReviewStats.js';
import { useRef, useState } from 'react';
import { Button } from '../../../ui/Button.jsx';
import { useStoreResource } from '../../hooks/useStoreResource.js';
import { retrievalStore, recordCombinedLectureReview } from '../../../stores/modelRetrieval.js';
import { gradeModel, selectDailyModels, dayKey, reviewDayKey } from '../../../engine/modelRetrieval.js';
import { recordLectureNotes, lectureNotesRecommendation, modelWithNotesEvidence } from '../../../engine/lectureNotesReview.js';

export function LectureRetrievalEnrollment({userId,blockId,lectureId,title,reference='',rows=[],evidenceModel={}}) {
  const resource=useStoreResource(retrievalStore,userId);
  const completion=useStoreResource(completionStore,userId);
  const reviewHistory=lectureReviewStats(completion.data?.[completionKey(lectureId,blockId)]);
  const [busy,setBusy]=useState(false);
  const saving=useRef(false);
  const [notice,setNotice]=useState('');
  const [savedModel,setSavedModel]=useState(null);
  const [notes,setNotes]=useState('');
  const [reviewing,setReviewing]=useState(false);
  const [checked,setChecked]=useState(false);
  const model=Object.values(resource.data?.models || {}).find(m=>m.lectureId===lectureId && m.blockId===blockId) || savedModel;
  const advice=lectureNotesRecommendation(rows,model || {},evidenceModel);
  const due=modelWithNotesEvidence(model || {},rows,evidenceModel,Date.now(),resource.data?.settings?.questionEvidence !== false).nextReviewAt;
  const save=async (transform, session)=>{
    if(saving.current || resource.loading || resource.error)return;
    saving.current=true;setBusy(true);setNotice('');
    try {let nextModel;await (session ? (uid,fn)=>recordCombinedLectureReview(uid,{blockId,lectureId},fn,session.at,session.eventId) : retrievalStore.update)(userId,data=>{const next=transform(data);nextModel=Object.values(next.models).find(m=>m.lectureId===lectureId&&m.blockId===blockId);return next;});setSavedModel(nextModel);return true;}
    catch(error){setNotice(`Could not save: ${error.message}. Please try again.`);return false;}
    finally{saving.current=false;setBusy(false);}
  };
  const complete=async()=>{
    const at=Date.now(), eventId=crypto.randomUUID();
    if(await save(data=>recordLectureNotes(data,{blockId,lectureId,title,completedReview:true,reference:notes.trim() || (!model ? reference : '')},at,eventId),{at,eventId})) {
      setNotes('');setNotice('Slides & notes review saved together. Your next review is shown here and in Today.');
    }
  };
  const grade=async value=>{
    const at=Date.now(),eventId=crypto.randomUUID();
    if(await save(data=>{
      const current=Object.values(data.models).find(m=>m.lectureId===lectureId&&m.blockId===blockId);
      const budget=selectDailyModels(Object.values(data.models),data.settings,at,blockId);
      if(!current || budget.slotsLeft<1 || current.minutes>budget.minutesLeft || current.history.some(h=>reviewDayKey(h)===dayKey(at)))throw Error('Today’s review budget is complete. Continue tomorrow.');
      const {notesAdvice:_,...projected}=modelWithNotesEvidence(current,rows,evidenceModel,at,data.settings?.questionEvidence!==false);
      return {...data,models:{...data.models,[current.id]:gradeModel(projected,value,at,eventId)}};
    },{at,eventId})) {setReviewing(false);setChecked(false);setNotice('Review recorded. Fresh questions will show whether the objective is improving.');}
  };
  return <section aria-label="Lecture notes and mental model" className="my-4 rounded-xl border border-border bg-bg-elevated p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-semibold">Slides & notes review</h3>
        <p className="mt-1 text-sm text-text-2">{model ? `Last reviewed ${new Date(model.notesCompletedAt || model.confirmedCreatedAt || model.createdAt).toLocaleDateString()}` : 'Log your slides and notes together when you finish a review.'}</p></div>
      {!model ? <Button variant="outline" disabled={busy||resource.loading||!!resource.error||!lectureId} onClick={complete}>{busy?'Saving…':'Log slides & notes review'}</Button>
        : <><Button variant="outline" disabled={busy||resource.loading||!!resource.error} onClick={complete}>Log slides & notes review</Button><Button variant="outline" disabled={busy||resource.loading||!!resource.error} onClick={()=>setReviewing(!reviewing)}>{reviewing?'Close review':'Check from memory'}</Button></>}
    </div>
    {model && <div className="mt-3 rounded-lg bg-panel p-3 text-sm">
      <p className="font-semibold">{due!=null&&due<=Date.now()?'Review due':`Next review: ${due==null?'as needed':new Date(due).toLocaleDateString()}`} · {advice.task}</p>
      {reviewing && <><p className="mt-2">{advice.instruction}</p><ul className="mt-2 list-disc pl-5">{advice.targets.map(row=><li key={row.id}>{row.text || row.code}</li>)}</ul>
        <label className="mt-3 flex gap-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>I tried from memory, checked my notes, and identified or corrected one gap.</label>
        <div className="mt-3 flex flex-wrap gap-2">{[['broken','Could not reconstruct'],['shaky','Some gaps remain'],['solid','Reconstructed clearly']].map(([value,label])=><Button key={value} variant="outline" disabled={!checked||busy||resource.loading} onClick={()=>grade(value)}>{label}</Button>)}</div>
        <p className="mt-2 text-xs text-text-3">This schedules your notes review; it does not mark objectives mastered. The daily review budget still applies.</p></>}
    </div>}
    <details className="mt-3 text-sm"><summary className="cursor-pointer text-accent-text">{model?'Optional notes / link':'Optional: attach your notes or model link'}</summary>
      <textarea aria-label="Your model reference" maxLength={12000} value={notes} onChange={e=>setNotes(e.target.value)} className="mt-2 w-full rounded-lg border border-border bg-bg-elevated p-2" placeholder="Paste a notes link, model, or a short description of what you drew. Optional." />
    </details>
    {reviewHistory.count>0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-text-2">Review history · {reviewHistory.count}</summary><ul className="mt-2 space-y-1 text-xs text-text-3">{[...reviewHistory.reviews].reverse().map((review,i)=><li key={review.id || i}>{review.date?.slice(0,10)} · {review.reviewKind==='slides-notes'?'Slides & notes':'Slides (historical)'}{review.durationMinutes?` · ${review.durationMinutes} min`:''}</li>)}</ul></details>}
    {resource.error && <p role="alert" className="mt-2 text-sm">Notes tracking could not sync. Saving is disabled until the connection recovers.</p>}
    {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
  </section>;
}
