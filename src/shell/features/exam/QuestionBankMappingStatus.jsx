import {useState} from 'react';
import * as meta from '../../../stores/questionBankMeta.js';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import {resumeQuestionBankMapping} from '../../logic/resumeQuestionBankMapping.js';
export function QuestionBankMappingStatus({userId,blockId,filename,lectures,objectives}){
 const resource=useStoreResource(meta,userId);
 const state=Object.values(resource.data||{}).find(m=>m.filename===filename&&m.blockId===blockId)?.mappingProgress;
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const linked=state?.linked||0,evaluated=state?.evaluated||0;
 return <div className="mt-2 rounded border border-border p-2 text-xs">
  <p className="font-semibold">Automatic curriculum links</p>
  <p className="mt-1 text-text-2">{state?.status==='complete'
   ? `${evaluated} questions checked · ${linked} source-supported ${linked===1?'link':'links'} saved${linked===0?' · unrelated possibilities were discarded':''}`
   : state?.status==='paused'
    ? `Paused after ${evaluated} questions · ${linked} completed ${linked===1?'link':'links'} saved`
    : state?.status==='running'
     ? `Checking lecture text and objectives · ${evaluated}/${state.total||'?'} evaluated`
     : 'Runs automatically after import. Only links supported by the lecture text are saved.'}</p>
  {state?.error&&<p role="status" className="mt-1 whitespace-pre-wrap">Reason: {state.error}</p>}
  {state?.currentQuestion&&state.status==='paused'&&<p>Stopped at source question: {state.currentQuestion}</p>}
  {state?.status==='paused'&&<button type="button" disabled={busy||resource.loading||!!resource.error} className="mt-2 rounded border border-border px-3 py-2 font-semibold" onClick={async()=>{
   setBusy(true);setError('');try{await resumeQuestionBankMapping({userId,blockId,filename,lectures,objectives});}catch(e){setError(e.message);}finally{setBusy(false);}
  }}>{busy?'Linking…':'Resume automatic linking'}</button>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
