import {useState} from 'react';
import {useStoreResource} from './hooks/useStoreResource.js';
import * as sourceUseStore from '../stores/sourceUse.js';
import {isEvaluationReserved,sourceExposure,sourceItemId} from '../engine/sourceUse.js';
export function SourceUseAdmin({userId,banks={},title="Evaluation reserves & exposure"}){
 const resource=useStoreResource(sourceUseStore,userId);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function toggle(filename,reserved){
  setBusy(true);setMessage('');
  try{await sourceUseStore.reserve(userId,filename,banks[filename] || [],reserved);setMessage(reserved?'Evaluation reservation saved.':'Reservation released; exposure history retained.');}
  catch(error){setMessage(`Reservation was not confirmed: ${error.message}`);}finally{setBusy(false);}
 }
 async function toggleFactual(filename,factual){
  setBusy(true);setMessage('');
  try{await sourceUseStore.setFactual(userId,filename,factual);setMessage(factual?'School source restored as factual evidence.':'Source marked not factual; it may still guide style but cannot support an answer key.');}
  catch(error){setMessage(`Factual-source change was not confirmed: ${error.message}`);}finally{setBusy(false);}
 }
 return <details className="mb-4 rounded border border-border p-3 text-sm"><summary className="cursor-pointer font-semibold">{title}</summary>
  <p className="mt-2 text-text-2">School homework, IMCQs and ExamSoft banks are factual question evidence by default when their answer key is usable. Mark a source not factual to keep it as a style reference only. Reserve keeps it out of generation examples entirely and enables its reserved timed assessment. Existing answers and scores are preserved.</p>
  {Object.entries(banks).map(([filename,questions])=>{
   const reserved=resource.data?.sources?.[filename]?.reserved===true;
   const exposed=questions.filter(question=>sourceExposure(question,resource.data)==='preparation-context').length;
   const delivered=questions.filter(q=>Object.keys(resource.data?.items?.[sourceItemId(q)]?.assessmentDeliveries || {}).length>0).length;
   const held=questions.filter(question=>isEvaluationReserved({...question,sourceFile:filename},resource.data)).length;
   const factual=resource.data?.sources?.[filename]?.factualAuthority!==false;
   return <div key={filename} className="mt-2 border-t border-border pt-2"><p>{filename}</p><p className="text-xs text-text-3">{held} reserved · {exposed} with recorded preparation context · {delivered} with assessment delivery attempts · other prior exposure unknown</p>
    <div className="mt-1 flex flex-wrap gap-2"><button disabled={busy || resource.loading || !!resource.error} className="rounded border border-border px-2 py-1" onClick={()=>toggle(filename,!reserved)}>{reserved?'Release reservation':'Reserve source'}</button><button disabled={busy || resource.loading || !!resource.error} className="rounded border border-border px-2 py-1" onClick={()=>toggleFactual(filename,!factual)}>{factual?'Mark not factual':'Trust as factual'}</button></div></div>;
  })}
  {resource.loading&&<p>Loading source exposure…</p>}{resource.error&&<p role="alert">Source exposure could not sync. Changes are disabled.</p>}{message&&<p role="status" className="mt-2">{message}</p>}
 </details>;
}
