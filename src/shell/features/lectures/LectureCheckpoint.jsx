import {useEffect,useRef,useState} from 'react';
import {listLectureCheckpoints} from '../../../firebaseData.js';
import {launchLectureCheckpoint,isLectureCheckpoint} from './lectureCheckpoint.js';
export function LectureCheckpoint({userId,lecture,blockId,config,busy=false,onOpenSession,onWorkingChange,loadSessions=listLectureCheckpoints,launch=launchLectureCheckpoint}){
 const controller=useRef(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const [count,setCount]=useState(10),[working,setWorking]=useState(false),[history,setHistory]=useState([]),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[progress,setProgress]=useState(null);
 useEffect(()=>{let live=true;setLoading(true);loadSessions(userId,blockId,lecture.id).then(items=>{if(live){setHistory((items||[]).filter(s=>isLectureCheckpoint(s)&&s.lectureIds?.includes(lecture.id)));setNotice('');}},error=>{if(live)setNotice(`Checkpoint history unavailable: ${error.message}`);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[userId,blockId,lecture.id,loadSessions]);
 const pending=history.find(s=>['in_progress','finalizing'].includes(s.status));
 const latest=history.filter(s=>s.status==='submitted').sort((a,b)=>b.submittedAt-a.submittedAt)[0];
 const begin=async()=>{const abort=new AbortController();controller.current=abort;setWorking(true);onWorkingChange?.(true);setNotice('');try{const result=await launch({...config,userId,lecture,blockId,questionCount:count,onProgress:setProgress,signal:abort.signal});if(result.ok)onOpenSession(result.sessionId);else setNotice(result.error);}catch(error){setNotice(error.message||String(error));}finally{setWorking(false);onWorkingChange?.(false);setProgress(null);}};
 return <section aria-label="Independent lecture checkpoint" className="my-4 rounded-xl border border-accent/40 bg-panel p-4">
  <h2 className="text-lg font-semibold">Independent lecture checkpoint</h2>
  <p className="mt-1 text-sm text-text-2">Test this lecture with fresh application and supported integration questions. No hints or answer feedback until submission. Timed at 90 seconds per question; the clock starts when you choose Start.</p>
  <p className="mt-1 text-xs text-text-3">Uses your lecture objectives and school question styles. Checkpoint scores stay separate from coached practice and are not a predicted school score.</p>
  <div className="mt-3 flex flex-wrap items-center gap-3">
   {pending?<button type="button" disabled={busy||working} className="rounded bg-accent px-3 py-2 text-bg" onClick={()=>onOpenSession(pending.sessionId)}>Resume saved checkpoint</button>:<><label className="text-sm">Questions <select aria-label="Checkpoint questions" value={count} disabled={working||busy} onChange={e=>setCount(Number(e.target.value))} className="ml-2 rounded border border-border bg-bg p-2">{[5,10,20].map(n=><option key={n}>{n}</option>)}</select></label><button type="button" disabled={working||busy||loading||!userId||!config.objectives?.length} onClick={begin} className="rounded border border-accent px-3 py-2 font-semibold text-accent disabled:opacity-50">{working?`Preparing checkpoint${progress?` · ${progress.ready||0} ready`:''}…`:'Prepare independent checkpoint'}</button></>}
   {working&&<button type="button" className="text-sm underline" onClick={()=>controller.current?.abort()}>Stop preparation</button>}
   {latest&&<button type="button" disabled={working||busy} className="text-sm underline" onClick={()=>onOpenSession(latest.sessionId)}>View latest checkpoint results</button>}
  </div>
  {loading&&<p role="status" className="mt-2 text-xs">Loading saved checkpoints…</p>}{notice&&<p role="status" className="mt-2 text-sm">{notice}</p>}
 </section>;
}
