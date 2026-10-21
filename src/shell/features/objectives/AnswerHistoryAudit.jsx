import {useEffect,useRef,useState} from 'react';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import * as calibrationStore from '../../../stores/calibrationByBlock.js';
import * as evidenceStore from '../../../stores/learnerEvidence.js';
import * as ratingsStore from '../../../stores/questionRatings.js';
import {listExamSessions} from '../../../supabase.js';
import {auditAnswerHistory} from '../../../engine/answerHistoryAudit.js';

export function AnswerHistoryAudit({userId,blockId,objectives=[],loading=false}){
 const calibration=useStoreResource(calibrationStore,userId);
 const evidence=useStoreResource(evidenceStore,userId);
 const ratings=useStoreResource(ratingsStore,userId);
 const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const started=useRef('');
 const syncError=calibration.error || evidence.error || ratings.error;
 const ready=!loading && !calibration.loading && !evidence.loading && !ratings.loading && !calibration.error && !evidence.error && !ratings.error;
 async function run(){
  setBusy(true);setError('');
  try{
   const sessions=await listExamSessions(userId,blockId);
   const {summary,events}=auditAnswerHistory({blockId,objectives:objectives.filter(o=>o.linkedLecId && (!o.blockId || o.blockId===blockId)),evidence:evidenceStore.read(userId),calibration:calibrationStore.readBlock(userId,blockId),sessions,excluded:event=>ratingsStore.isExcluded(userId,event,'objective') || ratingsStore.isExcluded(userId,event)});
   if(events.length)await evidenceStore.recordEvidenceBatchAwait(userId,events);
   setResult(summary);
  }catch(e){setError(`History reconciliation could not finish: ${e.message || String(e)}. Your source history has been kept.`);}finally{setBusy(false);}
 }
 useEffect(()=>{const key=`${userId}:${blockId}`;if(ready && objectives.length && started.current!==key){started.current=key;run();}},[ready,userId,blockId,objectives.length]);
 return <details className="mb-4 rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer font-semibold">Answer-history audit · {busy?'checking saved answers':(error || syncError)?'needs attention':result?'checked':'waiting for sync'}</summary>
 <p className="mt-2">Coverage counts linked question answers, not notes reviewed. Older review labels were included in the former percentage. Missing links do not prove that you have not studied a topic.</p>
 {result && <p className="mt-2" role="status">{result.answersInspected} saved answer records inspected · {result.recoveredAnswers} recovered · {result.repairedLinks} links repaired · {result.alreadyRecorded} already recorded · {result.needsLinking} answer records need objective links · {result.excluded} excluded. {result.legacyReviewedWithoutAnswers} review-labelled objectives lack question evidence. Logs may contain copies of the same answer.</p>}
 {syncError && <p role="alert" className="mt-2">History is not fully synced: {syncError.message || String(syncError)}. No audit repairs have been applied.</p>}
 {error && <p role="alert" className="mt-2">{error}</p>}
 <button type="button" disabled={busy || !ready} onClick={run} className="mt-2 rounded border border-border px-3 py-2 disabled:opacity-40">Audit and reconcile again</button>
 </details>;
}
