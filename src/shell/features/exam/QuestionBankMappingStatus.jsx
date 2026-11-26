import {MAPPING_VERSION} from '../../../engine/semanticObjectiveMapping.js';
import {useState} from 'react';
import * as meta from '../../../stores/questionBankMeta.js';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import {relinkAllQuestionBanks} from '../../logic/relinkQuestionBanks.js';
// One meta entry per filename, so a bank shown under its exam block still
// shows the linking done against the block that taught it.
export function QuestionBankMappingStatus({userId,filename}){
 const resource=useStoreResource(meta,userId);
 const state=Object.values(resource.data||{}).find(m=>m.filename===filename)?.mappingProgress;
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const linked=state?.linked||0,evaluated=state?.evaluated||0;
 const older=state?.version!=null&&state.version<MAPPING_VERSION;
 return <div className="mt-2 rounded border border-border p-2 text-xs">
  <p className="font-semibold">Automatic curriculum links</p>
  <p className="mt-1 text-text-2">{state?.status==='complete'
   ? `${evaluated} questions checked · ${linked} questions with verified objective links${state.lectureLinked!=null?` · ${state.lectureLinked} linked to a lecture`:''}`
   : state?.status==='paused'
    ? `Paused after ${evaluated} questions · ${linked} completed ${linked===1?'link':'links'} saved`
    : state?.status==='running'
     ? `Checking lecture text and objectives · ${evaluated}/${state.total||'?'} evaluated`
     : 'Runs automatically after import. Only links supported by the lecture text are saved.'}</p>
  {older&&linked<evaluated&&<p className="mt-1 text-text-2">Linking has been updated to search the full lecture and DLA concept directory. Recheck unresolved links; no re-import is needed.</p>}
  {state?.scope&&<p className="mt-1 text-text-2">Linked against {state.scope.filedBlockId!==state.scope.homeBlockId?'another block (where these questions were taught)':'this block'}{state.scope.focusWeeks?.length?` · focus ${state.scope.focusWeeks.length===1?'week':'weeks'} ending ${state.scope.focusWeeks.map(w=>w.startsWith('w')?`week ${w.slice(1)}`:w.slice(5)).join(', ')}`:''}{state.weekRescued?` · ${state.weekRescued} linked by week`:''}</p>}
  {state?.lastSearch&&<p className="mt-1 text-text-2">{state.lastSearch.sourceIndexed}/{state.lastSearch.scopeLectures} lecture and DLA sources indexed · {state.lastSearch.expanded?'expanded original-source search':'targeted original-source search'}</p>}
  {state?.status==='complete'&&linked<evaluated&&<p className="mt-1 text-text-2">Remaining objective links are unresolved; this does not mean the questions are unrelated to your lectures.</p>}
  {!!state?.unresolvedReasons?.length&&<details className="mt-1"><summary>{older?'Previous search explanations':'Why links remain unresolved'}</summary><ul>{state.unresolvedReasons.map(reason=><li key={reason}>{reason}</li>)}</ul></details>}
  {state?.error&&<p role="status" className="mt-1 whitespace-pre-wrap">Reason: {state.error}</p>}
  {state?.currentQuestion&&state.status==='paused'&&<p>Stopped at source question: {state.currentQuestion}</p>}
  {(state?.status==='paused'||state?.status==='complete'&&linked<evaluated)&&<button type="button" disabled={busy||resource.loading||!!resource.error} className="mt-2 rounded border border-border px-3 py-2 font-semibold" onClick={async()=>{
   setBusy(true);setError('');try{const [result]=await relinkAllQuestionBanks({userId,filenames:[filename]});if(result?.status==='paused')setError(result.error||'Linking paused.');}catch(e){setError(e.message);}finally{setBusy(false);}
  }}>{busy?'Linking…':state.status==='complete'?'Recheck unresolved links':'Resume automatic linking'}</button>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
