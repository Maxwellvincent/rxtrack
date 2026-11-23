import {useEffect,useMemo,useRef,useState} from 'react';
import {callAIJSON} from '../../../aiClient.js';
import * as relationships from '../../../stores/sourceRelationships.js';
import {objectiveConnectionMap,connectionStudyPlan,connectionPracticeRequest,prepareObjectiveConnections,objectiveSignature} from '../../../engine/objectiveConnections.js';
import {relationshipSourceVersion} from '../../../engine/sourceRelationships.js';
const labels={repair:'Needs repair',due:'Fresh retest due',unseen:'Not yet tested',waiting:'Practiced · retest later'};
/** One cached map per lecture source; answer evidence, never reading, drives progress. */
export function ObjectiveConnections({userId,catalog={},evidence={},scope,loading=false,error=null,enabled=true,busy=false,onPractice,prepare=prepareObjectiveConnections,save=relationships.save}){
 const [building,setBuilding]=useState(false),[notice,setNotice]=useState(''),[showAll,setShowAll]=useState(false),[progress,setProgress]=useState(0);
 const attempted=useRef(false),controller=useRef(null);
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{if(!enabled)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[enabled]);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const map=useMemo(()=>objectiveConnectionMap(catalog,evidence,scope,now),[catalog,evidence,scope,now]);
 const plan=useMemo(()=>connectionStudyPlan(map),[map]);
 const missing=map.filter(group=>!group.mapped);
 const build=async()=>{
  if(building||loading||error||busy)return;
  const abort=new AbortController();controller.current=abort;setBuilding(true);setNotice('');setProgress(0);
  let added=0;
  try{
   for(let i=0;i<missing.length;i+=2){
    const objectives=missing.slice(i,i+2).map(group=>group.objective);
    const bundles=await prepare({...scope,objectives,signal:abort.signal},callAIJSON);
    abort.signal.throwIfAborted();
    if(!bundles.length)throw new Error('The independent review could not confirm this batch. Previously saved connections remain available.');
    await save(userId,scope.lectureId,bundles);added+=bundles.length;setProgress(Math.min(i+2,missing.length));
   }
   setNotice(`${added} source-supported connections saved. Reading them does not count as an independent correct answer.`);
  }catch(e){if(!abort.signal.aborted)setNotice(`${added?`${added} connections saved. `:''}${e.message}`);}
  finally{if(!abort.signal.aborted)setBuilding(false);}
 };
 useEffect(()=>{
  if(!enabled||loading||error||busy||attempted.current||!scope.objectives.length||!scope.pages.some(page=>page.text?.trim()))return;
  attempted.current=true;if(missing.length)void build();
 // The first Learn visit starts once; failed or partial maps require an explicit retry.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,loading,error,busy,scope]);
 const active=plan.filter(row=>row.practiceState!=='waiting');
 const next=active.find(row=>!row.missingPrerequisites.length)||active[0];
 const visible=showAll?map:map.slice(0,4);
 return <section aria-label="Objective connection map" className="my-4 rounded-xl border border-border bg-bg-elevated p-4">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Connections to understand</h2><p className="mt-1 text-sm text-text-2">{map.filter(group=>group.mapped).length}/{map.length} objectives mapped · {plan.filter(row=>row.practiceState==='repair').length} connections need repair · {plan.filter(row=>row.practiceState==='due').length} retests due</p></div>
   {!!missing.length&&<button type="button" className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" disabled={building||busy||loading||!!error} onClick={build}>{building?`Building ${progress}/${missing.length} objectives…`:plan.length?'Build remaining connections':'Build connection map'}</button>}
  </div>
  {loading&&<p role="status">Loading saved connections…</p>}{error&&<p role="alert">Connections could not be loaded: {error.message}. Existing study progress is unchanged.</p>}{notice&&<p role="status" className="my-2 text-sm">{notice}</p>}
  {next&&<p className="my-3 rounded bg-accent-soft p-3 text-sm"><strong>Study next:</strong> {next.label}{next.missingPrerequisites.length?` · Start by revisiting ${next.missingPrerequisites.map(row=>row.label).join(', ')}`:''}</p>}
  <div className="mt-3 space-y-2">{visible.map(({objective,connections})=><details key={objective.id} className="rounded-lg border border-border p-3">
   <summary className="cursor-pointer font-semibold text-sm">{objective.objective||objective.text}<span className="ml-2 font-normal text-text-3">{connections.length?`${connections.length} connections`:'Not mapped yet'}</span></summary>
   {!connections.length&&<p className="mt-2 text-sm text-text-2">This objective still needs source-supported connections. Previous objective-level scores do not establish which connections you understand.</p>}
   <ol className="mt-3 space-y-3">{connections.map(row=><li key={row.id} className="rounded border border-border p-3">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-sm">{row.label}</h3><span className="text-xs text-text-3">{row.visualReviewRequired?'Visual source review needed':row.assistedAttempts&&!row.attempts?'Practiced with help · independent check needed':labels[row.practiceState]}{row.attempts?` · ${row.correct}/${row.attempts} independent answers`:''}</span></div>
    <p className="mt-2 text-sm"><strong>Explain to yourself:</strong> {row.learning.checkPrompt}</p>
    <details className="mt-2 text-sm"><summary className="cursor-pointer text-accent">See the connection and lecture evidence</summary><p className="mt-2">{row.learning.explanation}</p><blockquote className="mt-2 border-l-2 border-accent pl-3 text-text-2">{row.quote}</blockquote><p className="mt-1 text-xs text-text-3">Lecture source page {row.page}</p></details>
    {!!row.learning.prerequisiteIds?.length&&<p className="mt-2 text-xs text-text-3">Builds on: {row.learning.prerequisiteIds.map(id=>plan.find(parent=>parent.id===id)?.label).filter(Boolean).join(' · ')}</p>}
    {!row.visualReviewRequired&&<button type="button" disabled={busy||loading||!!error} className="mt-3 rounded border border-accent px-3 py-2 text-sm font-semibold text-accent disabled:opacity-50" onClick={()=>onPractice?.(connectionPracticeRequest({...row,objective}))}>Practice this connection →</button>}
   </li>)}</ol>
  </details>)}</div>
  {map.length>4&&<button type="button" className="mt-3 text-sm underline" onClick={()=>setShowAll(!showAll)}>{showAll?'Show fewer objectives':`Show all ${map.length} objectives`}</button>}
  <p className="mt-3 text-xs text-text-3">Connections are a source-supported learning map, not a guarantee of complete coverage. Older answers without an exact connection link remain objective-level evidence. Assisted answers and repeated questions do not establish fresh independent application.</p>
 </section>;
}
export function connectionMapKey(scope){return `${scope.lectureId}:${relationshipSourceVersion(scope.pages)}:${scope.objectives.map(objective=>objective.id+objectiveSignature(objective)).join(':')}`;}
