import {useState} from 'react';
import * as meta from '../../../stores/questionBankMeta.js';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import {resumeQuestionBankMapping} from '../../logic/resumeQuestionBankMapping.js';
export function QuestionBankMappingStatus({userId,blockId,filename,lectures,objectives}){
 const resource=useStoreResource(meta,userId);
 const state=Object.values(resource.data||{}).find(m=>m.filename===filename&&m.blockId===blockId)?.mappingProgress;
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div className="mt-2 rounded border border-border p-2 text-xs">
  <p>Objective mapping: {state?.status==='complete'?'evaluated':state?.status==='paused'?'paused':state?.status==='running'?'in progress':'not yet tracked'}{state?` · ${state.evaluated||0} evaluated · ${state.linked||0} verified question links`:''}</p>
  {state?.error&&<p role="status" className="mt-1 whitespace-pre-wrap">Reason: {state.error}</p>}
  {state?.currentQuestion&&state.status==='paused'&&<p>Stopped at source question: {state.currentQuestion}</p>}
  {state?.status!=='complete'&&<button type="button" disabled={busy||resource.loading||!!resource.error} className="mt-2 rounded border border-border px-3 py-2 font-semibold" onClick={async()=>{
   setBusy(true);setError('');try{await resumeQuestionBankMapping({userId,blockId,filename,lectures,objectives});}catch(e){setError(e.message);}finally{setBusy(false);}
  }}>{busy?'Mapping…':'Resume mapping'}</button>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
