import {useMemo,useState} from 'react';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import * as library from '../../../stores/reviewLibrary.js';
import {reviewModuleForBlock} from '../../../engine/reviewSourceContext.js';
import * as terms from '../../../stores/terms.js';
import {startBackgroundJob} from '../../backgroundJobs.js';
import {extractReviewFile} from '../../../ingest/reviewSources.js';

export function ReviewSourceStatus({userId,blockId}){
 const store=useMemo(()=>({read:uid=>library.read(uid,blockId),subscribe:cb=>library.subscribe(blockId,cb)}),[blockId]);
 const resource=useStoreResource(store,userId),manifest=resource.data;
 const [busy,setBusy]=useState(false);
 if(reviewModuleForBlock(terms.read(userId),blockId)!=='NB2')return null;
 function upload(files){
  if(!files.length)return;setBusy(true);
  startBackgroundJob({label:'Saving NB2 review sources',run:async update=>{
   try{
    // Preserve migrated sources before appending user-selected files.
    await library.ensureReviewLibrary(userId,blockId);
    const results=[];let saved=0;
    for(const file of files){try{update(`Reading ${file.name}…`);const pack=await extractReviewFile(file,update,library.read(userId,blockId).packs);if(pack.alreadySaved){saved++;results.push(`${file.name}: already saved to your account`);continue;}update(`Saving ${file.name} to your account…`);await library.addReviewPack(userId,blockId,pack);saved++;results.push(`${file.name}: saved · ${pack.units.length} pages/entries · ${pack.units.filter(u=>u.held||u.requiresFigure).length} excluded from text templates`);}catch(error){results.push(`${file.name}: not saved · ${error.message}`);}}
    if(!saved)throw new Error(results.join('\n'));return results.join('\n');
   }finally{setBusy(false);}
  }});
 }
 return <section className="my-3 rounded-lg border border-border p-4" aria-label="Review sources">
  <h3 className="text-sm font-semibold">NB2 review sources</h3>
  <p className="my-2 text-sm text-text-2" role="status">{manifest?.ready?`${manifest.packs.length} sources · ${manifest.totalUnits} pages/entries saved to your account`:'No review sources confirmed yet.'}</p>
  <p className="mb-3 text-xs text-text-3">Review summaries and teaching slides influence lecture quizzes, exams and guided cases across providers. No answer key needed. This saves extracted text, not a scored question bank or the original PDF. PDF text is read on your device; PDFs needing OCR use the Mac bridge during upload only.</p>
  <label className="inline-block cursor-pointer rounded-lg border border-border px-3 py-2 text-sm">{busy?'Saving sources…':'Upload review sources'}<input aria-label="Upload review sources" className="hidden" type="file" accept=".pdf,.md,.txt" multiple disabled={!userId||busy} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';upload(files);}} /></label>
  {manifest?.ready&&<details className="mt-3 text-sm"><summary className="cursor-pointer">Stored sources</summary><ul className="mt-2 space-y-1">{manifest.packs.map(p=><li key={p.id}>{p.name} · {p.count} pages/entries</li>)}</ul></details>}
 </section>;
}
