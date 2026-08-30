import { useEffect, useState } from 'react';
import { Button } from '../../../ui/Button.jsx';
import { useStoreResource } from '../../hooks/useStoreResource.js';
import { retrievalStore } from '../../../stores/modelRetrieval.js';
import { createRetrievalModel, gradeModel, selectDailyModels, settingsFor, dayKey } from '../../../engine/modelRetrieval.js';

const field='w-full rounded-lg border border-border bg-bg-elevated p-2 text-sm text-text-1';
const grades=[['broken','Broken','Could not reconstruct the major relationships.'],['shaky','Shaky','Reconstructed the outline but missed important connections.'],['solid','Solid','Reconstructed the framework without help.']];
const date = at => at == null ? 'No routine review' : new Date(at).toLocaleDateString();
const newId = () => crypto.randomUUID();

export function ModelRetrievalCard({userId,blockId,examDate}) {
  const resource=useStoreResource(retrievalStore,userId);
  const data=resource.data || {models:{},settings:{}};
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),30000);return ()=>clearInterval(id);},[]);
  const [activeId,setActiveId]=useState(null);
  const [revealed,setRevealed]=useState(false);
  const [scratch,setScratch]=useState('');
  const [attempted,setAttempted]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [creating,setCreating]=useState(false);
  const [draft,setDraft]=useState({title:'',prompt:'',reference:'',lecture:'',subject:'',tags:'',minutes:3,priority:1});
  const prefs=settingsFor(data.settings);
  const models=Object.values(data.models || {});
  const plan=selectDailyModels(models,prefs,now,blockId,examDate);
  const active=data.models?.[activeId];
  const blockModels=models.filter(m=>m.blockId===blockId);
  const canReview=model=>plan.slotsLeft>0 && model.minutes<=plan.minutesLeft && !(model.history||[]).some(h=>h.day===dayKey(now));
  const start=model=>{setActiveId(model.id);setRevealed(false);setAttempted(false);setScratch('');setNotice('');};
  const save = async transform => {
    if(busy || resource.loading || resource.error) return false;
    setBusy(true);setNotice('');
    try {
      // Read again at action time, not the earlier render, so new synced data is retained.
      await retrievalStore.update(userId,transform);
      return true;
    } catch(error) {setNotice(error.message || 'Could not save. Your review is still open; try again.');return false;}
    finally {setBusy(false);}
  };
  const grade=async value=>{
    const at=Date.now(), eventId=newId();
    let saved;
    const ok=await save(current=>{
      const model=current.models[activeId];
      const budget=selectDailyModels(Object.values(current.models),current.settings,at,blockId,examDate);
      if(!model || budget.slotsLeft<1 || model.minutes>budget.minutesLeft || model.history.some(h=>h.day===dayKey(at))) throw new Error('Today’s retrieval budget is complete. No extra review is needed.');
      saved={...current,models:{...current.models,[activeId]:gradeModel(model,value,at,eventId)}};
      return saved;
    });
    if(ok){
      const next=selectDailyModels(Object.values(saved.models),saved.settings,at,blockId,examDate).selected[0];
      setNow(at);
      if(next) start(next); else setActiveId(null);
      setNotice(next?'Review saved. Here is the next model.':'Review saved. Done for today.');
    }
  };
  if(resource.loading) return <section className="rounded-xl border border-border p-4">Loading model retrieval…</section>;
  if(resource.error) return <section role="alert" className="rounded-xl border border-border p-4">Model retrieval could not sync. Your existing study tools are unaffected.</section>;
  return <section aria-label="Mental model retrieval" className="rounded-xl border border-border bg-bg-elevated p-4 text-text-1">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-semibold">Today’s Retrieval</h2><p className="text-sm text-text-2">Anki schedules atoms. RXtrack schedules models. Questions test integration.</p></div>
      {!active && <Button disabled={busy||!plan.selected.length} onClick={()=>start(plan.selected[0])}>Start retrieval</Button>}
    </div>
    <p className="mt-3 text-sm">{plan.selected.length ? `${plan.selected.length} high-value models · ~${plan.selected.reduce((n,m)=>n+m.minutes,0)} min` : blockModels.length ? 'Nothing else selected for today.' : 'Add your first model below.'} · {plan.done} completed today</p>
    <p className="text-xs text-text-3">Daily budget across all blocks: {plan.spent}/{prefs.minutes} min · max {prefs.cap} models. Lower-priority models wait quietly.</p>
    {blockModels.some(m=>m.status==='Stable'||m.status==='Released') && <p className="mt-2 text-xs text-text-2">Stable / released: {blockModels.filter(m=>m.status==='Stable'||m.status==='Released').length} models</p>}
    {notice && <p role="status" className="my-3 text-sm font-semibold">{notice}</p>}
    {active ? <div className="my-4 max-w-3xl space-y-3 rounded-xl border-2 border-accent p-4">
      <div className="flex items-start justify-between gap-2"><h3 className="text-lg font-semibold">{active.title}</h3><span className="text-sm">~{active.minutes} min</span></div>
      <p className="text-base">{active.prompt}</p>
      <p className="text-sm text-text-2">Reconstruct the relationships from memory—on paper, aloud, or below. Keep your reference closed.</p>
      <textarea aria-label="Retrieval scratchpad" value={scratch} onChange={e=>setScratch(e.target.value)} placeholder="Optional scratchpad: A → B because…" className={`${field} min-h-28`} />
      {!revealed ? <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attempted} onChange={e=>setAttempted(e.target.checked)} />I attempted the model from memory (or could not reconstruct it).</label>
        <Button disabled={!attempted||busy} onClick={()=>setRevealed(true)}>Reveal / check reference</Button>
      </> : <>
        <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-panel p-3 text-sm">{active.reference || 'No reference saved. Check against your lecture or external notes before grading.'}</div>
        <p className="text-sm font-semibold">How well did you reconstruct it before looking?</p>
        <div className="grid gap-2 sm:grid-cols-3">{grades.map(([value,label,description],index)=><button key={value} type="button" disabled={busy} onClick={()=>grade(value)} className="rounded-lg border-2 border-border-strong p-3 text-left hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"><strong>{['×','~','✓'][index]} {label}</strong><span className="mt-1 block text-sm text-text-2">{description}</span></button>)}</div>
        <p className="text-xs text-text-3">Grades schedule this model only. Retest questions to clear atom/objective flags.</p>
      </>}
      <Button variant="ghost" disabled={busy} onClick={()=>setActiveId(null)}>Close without grading</Button>
    </div> : plan.selected.length>0 && <ul className="my-3 space-y-1 text-sm">{plan.selected.map(m=><li key={m.id}>{m.title} · {m.minutes} min</li>)}</ul>}

    {!active && <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer font-semibold">Model library · {blockModels.length}</summary>
      <div className="my-3"><Button variant="outline" onClick={()=>setCreating(!creating)}>{creating?'Close creation':'Add mental model'}</Button></div>
      {creating && <form className="mb-4 max-w-3xl space-y-3" onSubmit={async e=>{
        e.preventDefault();
        if(await save(current=>{const model=createRetrievalModel({...draft,id:newId(),blockId},Date.now(),prefs);return {...current,models:{...current.models,[model.id]:model}};})){setCreating(false);setDraft({title:'',prompt:'',reference:'',lecture:'',subject:'',tags:'',minutes:3,priority:1});setNotice('Model saved. Its first retrieval follows your daily budget.');}
      }}>
        {[['title','Model title'],['subject','Subject'],['lecture','Lecture / topic'],['tags','Related concepts / Anki tags (optional)']].map(([key,label])=><label key={key} className="block text-sm">{label}<input className={field} required={key==='title'} maxLength={key==='tags'?500:200} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}
        <label className="block text-sm">Retrieval prompt<textarea required maxLength={1500} className={field} value={draft.prompt} placeholder="From memory, reconstruct how the parts connect and explain why each connection matters." onChange={e=>setDraft({...draft,prompt:e.target.value})}/></label>
        <label className="block text-sm">Reference model / notes link (optional)<textarea maxLength={12000} className={`${field} min-h-24`} value={draft.reference} onChange={e=>setDraft({...draft,reference:e.target.value})}/></label>
        <label className="block text-sm">Estimated minutes<select className={field} value={draft.minutes} onChange={e=>setDraft({...draft,minutes:Number(e.target.value)})}>{[2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label>
        <label className="block text-sm">Importance<select className={field} value={draft.priority} onChange={e=>setDraft({...draft,priority:Number(e.target.value)})}><option value={1}>Normal</option><option value={2}>Important</option><option value={3}>Starred priority</option></select></label>
        <Button type="submit" disabled={busy}>Save model</Button>
      </form>}
      <div className="space-y-2">{blockModels.map(model=><details key={model.id} className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{model.title} · {model.status}</summary>
        <p className="my-2 text-sm">{model.subject} · {model.lecture} · {model.tags}</p>
        <p className="text-sm">{model.prompt}</p>
        <p className="my-2 text-xs text-text-3">Last retrieval: {model.lastReviewedAt?date(model.lastReviewedAt):'Not yet'} · Next suggested: {date(model.nextReviewAt)} · {model.solidStreak} spaced Solid grades</p>
        <Button variant="outline" disabled={busy||!!active||!canReview(model)} onClick={()=>start(model)}>Review now</Button>
        <details className="mt-2"><summary className="cursor-pointer text-sm">Edit model / reference</summary><form className="mt-2 space-y-2" onSubmit={async e=>{
          e.preventDefault(); const form=new FormData(e.currentTarget);
          const title=String(form.get('title')).trim(), prompt=String(form.get('prompt')).trim(), reference=String(form.get('reference'));
          if(!title||!prompt){setNotice('Title and retrieval prompt cannot be blank.');return;}
          if(await save(current=>({...current,models:{...current.models,[model.id]:{...current.models[model.id],title,prompt,reference}}}))) setNotice('Model changes saved.');
        }}><label className="block text-sm">Title<input name="title" required maxLength={200} defaultValue={model.title} className={field}/></label><label className="block text-sm">Prompt<textarea name="prompt" required maxLength={1500} defaultValue={model.prompt} className={field}/></label><label className="block text-sm">Reference<textarea name="reference" maxLength={12000} defaultValue={model.reference} className={`${field} min-h-24`}/></label><Button type="submit" disabled={busy}>Save changes</Button></form></details>
        <details className="mt-2"><summary className="cursor-pointer text-sm">Retrieval history · {model.history.length}</summary><ol className="mt-2 space-y-1 text-sm">{[...model.history].reverse().slice(0,20).map(h=><li key={h.id}>{date(h.at)} · {h.grade} · {h.minutes} min{h.early?' · early check':''}</li>)}</ol></details>
        {!!model.evidence.length && <p className="mt-2 text-xs">Linked evidence: {model.evidence.length} events · latest {model.evidence.at(-1).type}</p>}
      </details>)}</div>
    </details>}
    <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer font-semibold">Retrieval settings</summary>
      <div className="mt-3 max-w-md space-y-3">
        <label className="block text-sm">Daily minute budget<select className={field} disabled={busy} value={prefs.minutes} onChange={e=>save(current=>({...current,settings:{...current.settings,minutes:Number(e.target.value)}}))}>{[5,10,15,20].map(n=><option key={n}>{n}</option>)}</select></label>
        <label className="block text-sm">Maximum models per day<select className={field} disabled={busy} value={prefs.cap} onChange={e=>save(current=>({...current,settings:{...current.settings,cap:Number(e.target.value)}}))}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label>
        {[['sameDay','Allow first retrieval today'],['questionEvidence','Use explicitly linked question evidence'],['ankiEvidence','Use explicitly linked Anki evidence'],['weekend','Optional Saturday cumulative retrieval (same daily budget)']].map(([key,label])=><label key={key} className="flex gap-2 text-sm"><input type="checkbox" checked={prefs[key]} disabled={busy} onChange={e=>save(current=>({...current,settings:{...current.settings,[key]:e.target.checked}}))}/>{label}</label>)}
        <p className="text-xs text-text-3">Question/Anki evidence hooks are ready; automatic mapping is not connected yet. Early Solid checks do not accelerate release. Minutes are planned retrieval time, not a stopwatch.</p>
      </div>
    </details>
  </section>;
}
