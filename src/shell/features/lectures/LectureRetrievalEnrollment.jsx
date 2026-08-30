import { useState } from 'react';
import { Button } from '../../../ui/Button.jsx';
import { useStoreResource } from '../../hooks/useStoreResource.js';
import { retrievalStore } from '../../../stores/modelRetrieval.js';
import { enrollLectureModel } from '../../../engine/modelRetrieval.js';

export function LectureRetrievalEnrollment({userId,blockId,lectureId,title,reference=''}) {
  const resource=useStoreResource(retrievalStore,userId);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [saved,setSaved]=useState(false);
  const [notes,setNotes]=useState('');
  const model=Object.values(resource.data?.models || {}).find(m=>m.lectureId===lectureId && m.blockId===blockId);
  const enrolled=!!model || saved;
  return <section aria-label="Lecture model retrieval" className="my-3 max-w-3xl rounded-xl border border-border bg-bg-elevated p-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-semibold">{enrolled?'✓ Model created · in retrieval':'Created your mental model?'}</h3>
        <p className="text-sm text-text-2">{enrolled?'Find it in Today → Today’s Retrieval → Model library.':'Confirm after building your own model—in chat, on paper, or here.'}</p></div>
      {!enrolled && <Button variant="outline" disabled={busy||resource.loading||!!resource.error||!lectureId} onClick={async()=>{
        setBusy(true);setNotice('');
        const input={blockId,lectureId,title,reference:notes.trim() || reference};
        const at=Date.now();
        try {await retrievalStore.update(userId,data=>enrollLectureModel(data,input,at));setSaved(true);setNotice('Saved to retrieval. Your daily time budget still applies.');}
        catch(error){setNotice(`Could not save: ${error.message}. Please try again.`);}
        finally{setBusy(false);}
      }}>{busy?'Saving…':'I created my mental model'}</Button>}
    </div>
    {!enrolled && <details className="mt-2 text-sm"><summary className="cursor-pointer">Optional: attach your model or notes link</summary>
      <textarea aria-label="Your model reference" maxLength={12000} value={notes} onChange={e=>setNotes(e.target.value)} className="mt-2 w-full rounded-lg border border-border bg-bg-elevated p-2" placeholder="Paste your model or a link. Otherwise the saved big-picture reference is used, if available." />
    </details>}
    {model && <p className="mt-2 text-sm">{model.status} · {model.nextReviewAt==null?'Released from routine retrieval':`Next suggested: ${new Date(model.nextReviewAt).toLocaleDateString()}`}</p>}
    {resource.error && <p role="alert" className="mt-2 text-sm">Retrieval could not sync; enrollment is disabled until sync recovers.</p>}
    {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
  </section>;
}
