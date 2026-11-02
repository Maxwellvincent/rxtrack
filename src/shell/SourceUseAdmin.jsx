import {useState} from 'react';
import {useStoreResource} from './hooks/useStoreResource.js';
import * as sourceUseStore from '../stores/sourceUse.js';
import {isEvaluationReserved,sourceExposure} from '../engine/sourceUse.js';
export function SourceUseAdmin({userId,banks={}}){
 const resource=useStoreResource(sourceUseStore,userId);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function toggle(filename,reserved){
  setBusy(true);setMessage('');
  try{await sourceUseStore.reserve(userId,filename,banks[filename] || [],reserved);setMessage(reserved?'Evaluation reservation saved.':'Reservation released; exposure history retained.');}
  catch(error){setMessage(`Reservation was not confirmed: ${error.message}`);}finally{setBusy(false);}
 }
 return <details className="mb-4 rounded border border-border p-3 text-sm"><summary className="cursor-pointer font-semibold">Evaluation reserves & exposure</summary>
  <p className="mt-2 text-text-2">Reservations exclude originals from generation and calibration. Exposure means supplied preparation context, not proof of model use. Historical exposure remains unknown. No answers or scores are changed.</p>
  {Object.entries(banks).map(([filename,questions])=>{
   const reserved=resource.data?.sources?.[filename]?.reserved===true;
   const exposed=questions.filter(question=>sourceExposure(question,resource.data)==='preparation-context').length;
   const held=questions.filter(question=>isEvaluationReserved({...question,sourceFile:filename},resource.data)).length;
   return <div key={filename} className="mt-2 border-t border-border pt-2"><p>{filename}</p><p className="text-xs text-text-3">{held} reserved · {exposed} with recorded preparation context · other prior exposure unknown</p>
    <button disabled={busy || resource.loading || !!resource.error} className="mt-1 rounded border border-border px-2 py-1" onClick={()=>toggle(filename,!reserved)}>{reserved?'Release reservation':'Reserve source'}</button></div>;
  })}
  {resource.loading&&<p>Loading source exposure…</p>}{resource.error&&<p role="alert">Source exposure could not sync. Changes are disabled.</p>}{message&&<p role="status" className="mt-2">{message}</p>}
 </details>;
}
