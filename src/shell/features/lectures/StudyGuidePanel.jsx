import {useMemo,useState} from 'react';
import * as guides from '../../../stores/studyGuides.js';
import {normalizeStudyGuide,selectGuideRows} from '../../../engine/studyGuides.js';
import {bridgeStudyTables} from '../../../llmBridge.js';
import {uploadQuestionBankSource,fetchQuestionBankSourceUrl} from '../../../supabase.js';
import {useStoreResource} from '../../hooks/useStoreResource.js';
export function StudyGuidePanel({userId,blockId,lecture,objectives=[],mode='sources'}){
 const store=useMemo(()=>({read:id=>guides.read(id,blockId),subscribe:fn=>guides.subscribe(blockId,fn),isHydrated:id=>guides.isHydrated(id,blockId),readError:id=>guides.readError(id,blockId)}),[blockId]);
 const resource=useStoreResource(store,userId),[preview,setPreview]=useState(null),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const subject=lecture?.lectureTitle || lecture?.title || lecture?.fileName || '';
 const rows=useMemo(()=>selectGuideRows(resource.data,{subject,objectives},12),[resource.data,subject,objectives]);
 const groups=useMemo(()=>{const out=new Map();for(const r of rows){const key=r.objectiveId;if(!out.has(key))out.set(key,[]);out.get(key).push(r);}return [...out];},[rows]);
 async function inspect(selected){if(!selected)return;setBusy(true);setMessage('Reading table rows locally…');setPreview(null);setFile(null);
  try{const raw=/\.json$/i.test(selected.name)?JSON.parse(await selected.text()):await bridgeStudyTables(selected);const next=normalizeStudyGuide(raw,{name:selected.name.replace(/\.(pdf|json)$/i,'')});setPreview({...next,storagePath:resource.data?.guides?.[next.id]?.storagePath || null});setFile(/\.pdf$/i.test(selected.name)?selected:null);setMessage('Preview ready. Nothing has been saved or credited as practice.');}catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 async function save(){setBusy(true);try{let storagePath=preview.storagePath;if(userId&&file&&!storagePath)storagePath=await uploadQuestionBankSource(userId,blockId,file);await guides.save(userId,blockId,{...preview,storagePath});setPreview(null);setFile(null);setMessage('Study tables saved for this block. Relevant rows are available across lectures and generated exams; no answer coverage was added.');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 async function openSource(row){try{const guide=resource.data.guides?.[row.guideId];const url=await fetchQuestionBankSourceUrl(guide?.storagePath);if(!url)throw new Error('Original PDF was not archived with this extract.');window.open(`${url}#page=${row.page}`,'_blank','noopener,noreferrer');}catch(e){setMessage(e.message);}}
 if(mode==='learn'&&!rows.length)return null;
 return <section className="my-4 rounded-xl border border-border p-4" aria-label={mode==='sources'?'Supplementary study tables':'Key relationships from study tables'}>
 <h3 className="font-semibold">{mode==='sources'?'Study tables for this block':'Key relationships'}</h3>
 {mode==='sources'?<><p className="my-2 text-sm text-text-2">Import once for the block. Tables guide comparisons and topic coverage; original lectures verify answers. They do not replace school question examples.</p>
 <label className="text-sm">Add study-table PDF or prepared extract<input aria-label="Add study tables" className="block my-2" type="file" accept=".pdf,.json" disabled={busy||resource.loading||!!resource.error} onChange={e=>{inspect(e.target.files?.[0]);e.target.value='';}} /></label>
 {preview&&<div className="my-3 rounded border border-border p-3"><strong>{preview.name}</strong><p className="text-sm">{preview.pageCount} pages · {preview.rows.length} rows · {preview.rows.filter(r=>r.held).length} held for layout or lecture assignment</p><p className="text-sm">Mappings are suggestions; each generated question must pass lecture-based review.</p><details><summary>Inspect extracted rows</summary>{preview.rows.slice(0,8).map(r=><GuideRow key={r.id} row={r} />)}</details><button className="mt-2 rounded bg-accent px-3 py-2 text-white disabled:opacity-40" disabled={busy} onClick={save}>Save guide to block</button></div>}
 <ul className="my-2 text-sm">{Object.values(resource.data?.guides || {}).map(g=><li key={g.id}>{g.name} · {g.rows.length} rows · {g.rows.filter(r=>r.held).length} held</li>)}</ul></>:<p className="my-2 text-sm text-text-2">Suggested comparisons grouped by objective. Reading these does not count as tested understanding.</p>}
 {resource.loading&&<p>Loading saved guides…</p>}{resource.error&&<p role="alert">Study tables could not sync. Please reconnect before importing.</p>}
 {groups.map(([id,items])=><details key={id} className="mt-2"><summary className="cursor-pointer text-sm">{objectives.find(o=>String(o.id || o.code)===id)?.objective || objectives.find(o=>String(o.id || o.code)===id)?.text || 'Lecture comparisons'} · {items.length} suggestions</summary>{items.map(r=><GuideRow key={r.id} row={r} openSource={()=>openSource(r)} />)}</details>)}
 {mode==='sources'&&!resource.loading&&!rows.length&&Object.keys(resource.data?.guides || {}).length>0&&<p className="text-sm">No confidently retrieved rows for this lecture’s current objectives. No links were guessed.</p>}
 {message&&<p role="status" className="mt-2 text-sm">{message}</p>}
 </section>;
}
function GuideRow({row,openSource}){return <details className="my-2 rounded border border-border p-2 text-sm"><summary>{row.label} · page {row.page}{row.held?' · held':''}</summary><p className="mt-2 text-text-2">{row.heading}</p>{row.headers.map((h,i)=><p key={i}><strong>{h}: </strong>{row.cells[i]}</p>)}{row.context&&<p className="mt-2">Context: {row.context}</p>}{row.notes&&<p className="mt-2">Notes: {row.notes}</p>}{openSource&&<button className="mt-2 underline" onClick={openSource}>Open original table page</button>}</details>;}
