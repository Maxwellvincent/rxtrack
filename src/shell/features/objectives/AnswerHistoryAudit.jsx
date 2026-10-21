import {blockProgressProjection} from '../../logic/blockProgress.js';
import * as generatedStore from '../../../stores/generatedQuestions.js';
import * as bankStore from '../../../stores/questionBanks.js';
import {historySourceQuestions} from '../../../engine/answerHistorySources.js';
import {useEffect,useRef,useState} from 'react';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import * as calibrationStore from '../../../stores/calibrationByBlock.js';
import * as evidenceStore from '../../../stores/learnerEvidence.js';
import * as ratingsStore from '../../../stores/questionRatings.js';
import {listExamSessions} from '../../../supabase.js';
import {auditAnswerHistory} from '../../../engine/answerHistoryAudit.js';

export function AnswerHistoryAudit({userId,blockId,objectives=[],lectures=[],loading=false}){
 const generated=useStoreResource(generatedStore,userId);
 const banks=useStoreResource(bankStore,userId);
 const [details,setDetails]=useState(null);
 const calibration=useStoreResource(calibrationStore,userId);
 const evidence=useStoreResource(evidenceStore,userId);
 const ratings=useStoreResource(ratingsStore,userId);
 const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const started=useRef('');
 const syncError=generated.error || banks.error || calibration.error || evidence.error || ratings.error;
 const ready=!syncError && !generated.loading && !banks.loading && !loading && !calibration.loading && !evidence.loading && !ratings.loading && !calibration.error && !evidence.error && !ratings.error;
 async function run(){
  setBusy(true);setError('');
  try{
   const sessions=await listExamSessions(userId,blockId);
   const audit=auditAnswerHistory({blockId,objectives:blockProgressProjection({blockId,lectures,catalog:objectives,evidence:evidenceStore.read(userId)}).linked,evidence:evidenceStore.read(userId),calibration:calibrationStore.readBlock(userId,blockId),sessions,sourceQuestions:historySourceQuestions({generated:generatedStore.read(userId),banks:bankStore.read(userId),lectures,blockId}),excluded:event=>ratingsStore.isExcluded(userId,event,'objective') || ratingsStore.isExcluded(userId,event)});
   const {summary,events}=audit;
   if(events.length)await evidenceStore.recordEvidenceBatchAwait(userId,events);
   setResult(summary);setDetails(audit);
  }catch(e){setError(`History reconciliation could not finish: ${e.message || String(e)}. Your source history has been kept.`);}finally{setBusy(false);}
 }
 useEffect(()=>{const key=`${userId}:${blockId}`;if(ready && objectives.length && started.current!==key){started.current=key;run();}},[ready,userId,blockId,objectives.length]);
 return <details className="mb-4 rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer font-semibold">Answer-history audit · {busy?'checking saved answers':(error || syncError)?'needs attention':result?'checked':'waiting for sync'}</summary>
 <p className="mt-2">Coverage counts linked question answers, not notes reviewed. Older review labels were included in the former percentage. Missing links do not prove that you have not studied a topic.</p>
 {result && <p className="mt-2" role="status">{result.answersInspected} saved answer records inspected · {result.recoveredAnswers} recovered · {result.repairedLinks} links repaired · {result.alreadyRecorded} already recorded · {result.needsLinking} answer records need objective links · {result.excluded} excluded. {result.legacyReviewedWithoutAnswers} review-labelled objectives lack question evidence. Logs may contain copies of the same answer.</p>}
 {details?.origins?.length>0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left font-semibold">Where the answer records came from</caption><thead><tr>{['Source','Inspected','Need links','Recovered','Already recorded'].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{details.origins.map(row=><tr key={row.source}><td className="p-2">{row.source}</td><td className="p-2">{row.inspected}</td><td className="p-2">{row.needsLinking}</td><td className="p-2">{row.recovered + row.repaired}</td><td className="p-2">{row.alreadyRecorded}</td></tr>)}</tbody></table></div>}
 {details?.unresolved?.length>0 && <details className="mt-3"><summary>Inspect unresolved records ({details.unresolved.length})</summary><p className="my-2">These are answer records, not additional objectives or failed answers. Reference-source objectives stay outside lecture totals.</p><ul className="space-y-2">{details.unresolved.slice(0,6).map((row,i)=><li key={i} className="rounded border border-border p-2"><strong>{row.source}</strong> · {row.reason}<p>{row.stem || 'No question text was retained in this log.'}</p></li>)}</ul><button type="button" className="mt-2 rounded border border-border p-2" onClick={()=>{const blob=new Blob([JSON.stringify({blockId,summary:details.summary,origins:details.origins,unresolved:details.unresolved},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='rxtrack-answer-history-audit.json';a.click();URL.revokeObjectURL(url);}}>Download all unresolved records</button></details>}
 {syncError && <p role="alert" className="mt-2">History is not fully synced: {syncError.message || String(syncError)}. No audit repairs have been applied.</p>}
 {error && <p role="alert" className="mt-2">{error}</p>}
 <button type="button" disabled={busy || !ready} onClick={run} className="mt-2 rounded border border-border px-3 py-2 disabled:opacity-40">Audit and reconcile again</button>
 </details>;
}
