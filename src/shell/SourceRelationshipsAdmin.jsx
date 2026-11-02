import {useMemo,useState} from 'react';
import {useStoreResource} from './hooks/useStoreResource.js';
import * as relationshipsStore from '../stores/sourceRelationships.js';
import * as learnerEvidence from '../stores/learnerEvidence.js';
import {createSourceRelationship,relationshipPages,relationshipCoverage} from '../engine/sourceRelationships.js';
import {fetchLectureContent} from '../supabase.js';
import {getLecText} from '../lectureText.js';
import {formatLectureLabel} from '../lectureTitle.js';
function LectureRelationships({userId,lecture,objectives}){
 const adapter=useMemo(()=>({read:id=>relationshipsStore.read(id,lecture.id),subscribe:callback=>relationshipsStore.subscribe(lecture.id,callback),isHydrated:id=>relationshipsStore.isHydrated(id,lecture.id),readError:id=>relationshipsStore.readError(id,lecture.id)}),[lecture.id]);
 const catalog=useStoreResource(adapter,userId),evidence=useStoreResource(learnerEvidence,userId);
 const [loaded,setLoaded]=useState(lecture),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const pages=relationshipPages(loaded,getLecText(loaded));
 const scope={blockId:lecture.blockId,lectureId:lecture.id,objectives,pages};
 const rows=relationshipCoverage(catalog.data,evidence.data,scope);
 async function load(){setBusy(true);try{const remote=await fetchLectureContent(userId,lecture.id);if(!remote)throw new Error('No saved source content');setLoaded({...lecture,...remote,id:lecture.id,blockId:lecture.blockId});setMessage('Original source text loaded.');}catch(error){setMessage(error.message);}finally{setBusy(false);}}
 async function save(event){event.preventDefault();const form=event.currentTarget,data=new FormData(form);setBusy(true);setMessage('');
  try{const objective=objectives.find(objective=>objective.id===data.get('objective'));
   const bundle=createSourceRelationship({...scope,objective,clause:data.get('clause'),label:data.get('label'),quote:data.get('quote'),page:data.get('page'),kind:data.get('kind')});
   await relationshipsStore.save(userId,lecture.id,[bundle]);setMessage('Source relationship saved. No answer coverage was added.');form.reset();
  }catch(error){setMessage(error.message);}finally{setBusy(false);}
 }
 return <div className="mt-3 text-sm">
  {catalog.loading&&<p>Loading source relationship records…</p>}
  {!catalog.loading&&<p>Partial source inventory: {rows.filter(row=>row.attempts>0).length}/{rows.length} registered relationships answered. This is not complete objective coverage or mastery.</p>}
  <button className="my-2 rounded border border-border px-2 py-1" disabled={busy} onClick={load}>Load original source text</button>
  <ul className="space-y-2">{Object.values(catalog.data?.relationships || {}).map(row=>{
   const current=rows.find(current=>current.id===row.id);
   return <li key={row.id} className="rounded border border-border p-2"><strong>{row.label}</strong><p className="text-xs text-text-3">Page {row.page} · {row.kind} · {current?`${current.attempts} distinct questions answered`:'Source changed or parent link unresolved'}{row.visualReviewRequired?' · visual review required':''}</p><details><summary>Source evidence</summary><p>{row.quote}</p><p className="text-xs">{row.id}</p></details></li>;
  })}</ul>
  <details className="mt-3"><summary>Add a source-backed relationship</summary><p className="my-2 text-xs text-text-3">Quote the original page and the exact parent objective clause. A located quote establishes provenance, not medical certification. Figure records require visual review and cannot fill text-only quiz slots.</p>
   <form onSubmit={save} className="grid gap-2">
    <label>Parent objective<select required name="objective" className="block w-full border border-border bg-bg p-2">{objectives.map(objective=><option key={objective.id} value={objective.id}>{objective.objective || objective.text}</option>)}</select></label>
    <label>Concept label<input required name="label" maxLength={160} className="block w-full border border-border bg-bg p-2" /></label>
    <label>Exact objective clause<textarea required name="clause" maxLength={1000} className="block w-full border border-border bg-bg p-2" /></label>
    <label>Original source quotation<textarea required name="quote" maxLength={2400} className="block w-full border border-border bg-bg p-2" /></label>
    <label>Source page<input required type="number" name="page" min="1" className="block w-full border border-border bg-bg p-2" /></label>
    <label>Evidence type<select name="kind" className="block w-full border border-border bg-bg p-2"><option value="text">Text</option><option value="table">Table text</option><option value="figure">Figure caption / source reference</option></select></label>
    <button disabled={busy || catalog.loading || !!catalog.error} className="rounded border border-border p-2">Save relationship</button>
   </form>
  </details>
  {catalog.error&&<p role="alert">Relationship records could not sync. Saving is disabled.</p>}{message&&<p role="status" className="mt-2">{message}</p>}
 </div>;
}
export function SourceRelationshipsAdmin({userId,lectures=[],objectives=[]}){
 const [selected,setSelected]=useState('');const lecture=lectures.find(lecture=>lecture.id===selected);
 const own=objectives.filter(objective=>(objective.linkedLecId || objective.lectureId)===selected && (!objective.blockId || objective.blockId===lecture?.blockId));
 return <details className="mb-4 rounded border border-border p-3"><summary className="cursor-pointer font-semibold">Source-backed objective relationships</summary>
  <p className="my-2 text-sm text-text-2">Reviewed questions can register exact objective clauses and source relationships automatically. Existing answers are not retroactively assigned to new relationships.</p>
  <label className="text-sm">Lecture<select aria-label="Relationship lecture" className="ml-2 border border-border bg-bg p-2" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Choose a lecture</option>{lectures.map(lecture=><option key={lecture.id} value={lecture.id}>{formatLectureLabel(lecture)}</option>)}</select></label>
  {lecture&&<LectureRelationships key={lecture.id} userId={userId} lecture={lecture} objectives={own} />}
 </details>;
}
