import {withDeadline} from '../asyncDeadline.js';
import {useEffect,useRef,useState} from 'react';
import {COACH_OPENING,reasoningCoachTurn} from '../engine/reasoningCoach.js';

/** Mounted only in untimed practice. Key by question identity to isolate turns. */
export function HelpMeReason({question,userId,initialState={},onAssist,onState,onBusy,request=reasoningCoachTurn}) {
 const [open,setOpen]=useState(false),[turns,setTurns]=useState(initialState.turns||[]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const busyRef=useRef(false),abort=useRef(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();};},[]);
 const begin=async()=>{
  if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');onBusy?.(true);
  abort.current=new AbortController();
  try{await withDeadline(()=>onAssist?.(),15000,abort.current.signal,'Saving assisted practice');if(mounted.current)setOpen(true);}
  catch(e){if(mounted.current)setError(e.message||'Could not save the assisted-practice marker. Retry before using help.');}
  finally{busyRef.current=false;if(mounted.current)setBusy(false);onBusy?.(false);}
 };
 const send=async(action)=>{
  if(busyRef.current || (action==='respond'&&!input.trim()))return;
  busyRef.current=true;setBusy(true);setError('');onBusy?.(true);
  const history=input.trim()?[...turns,{role:'learner',text:input.trim().slice(0,2000)}]:turns;
  abort.current=new AbortController();
  try{
   await withDeadline(()=>onAssist?.(),15000,abort.current.signal,'Saving assisted practice');
   const reply=await request({question,userId,turns:history,action,signal:abort.current.signal});
   if(!mounted.current)return;
   const next=[...history,{role:'coach',text:[reply.feedback,reply.hint,reply.question].filter(Boolean).join('\n'),readyToTry:reply.readyToTry}].slice(-24);
   await withDeadline(()=>onState?.({turns:next}),15000,abort.current.signal,'Saving the reasoning conversation');
   if(!mounted.current)return;
   setTurns(next);setInput('');
  }catch(e){if(mounted.current)setError(e.message||'Could not load the next step. Your answer has not been revealed.');}
  finally{busyRef.current=false;if(mounted.current)setBusy(false);onBusy?.(false);}
 };
 return <section className="my-3 rounded-lg border border-accent/30 bg-panel p-3" aria-label="Help Me Reason" onKeyDown={event=>event.stopPropagation()}>
  {!open?<button type="button" className="text-sm font-semibold text-accent-text disabled:opacity-50" disabled={busy} onClick={begin}>Help Me Reason</button>:<>
   <div className="flex items-center justify-between gap-2"><strong className="text-sm">Help Me Reason</strong><button type="button" className="text-xs underline" disabled={busy} onClick={()=>setOpen(false)}>Back to question</button></div>
   <p className="my-2 text-xs text-text-3">Assisted practice · saved separately from independent readiness. The answer stays hidden until you check it.</p>
   <p className="text-sm">{COACH_OPENING}</p>
   <div className="mt-2 max-h-72 space-y-3 overflow-auto" aria-live="polite">{turns.map((turn,i)=><p key={i} className="whitespace-pre-line text-sm text-text-2"><strong>{turn.role==='learner'?'You: ':'Coach: '}</strong>{turn.text}</p>)}</div>
   {turns.at(-1)?.readyToTry&&<p className="mt-2 text-sm text-accent-text">Try the original question now. A fresh question later will check independent transfer.</p>}
   <label className="mt-3 block text-sm">Your reasoning<textarea aria-label="Your reasoning for the coach" rows={3} maxLength={2000} className="mt-1 w-full rounded border border-border bg-bg p-2" value={input} disabled={busy} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.stopPropagation()} placeholder="Which clue are you using, and what connection are you making?" /></label>
   <div className="mt-2 flex flex-wrap gap-3"><button type="button" className="rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50" disabled={busy||!input.trim()} onClick={()=>send('respond')}>Check my reasoning</button><button type="button" className="text-sm underline disabled:opacity-50" disabled={busy} onClick={()=>send('next-step')}>Show next step</button></div>
  </>}
  {busy&&<p role="status" className="mt-2 text-xs">{open?'Checking the next connection…':'Saving assisted practice…'}</p>}
  {error&&<p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
 </section>;
}
