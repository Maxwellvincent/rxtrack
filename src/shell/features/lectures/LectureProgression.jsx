import {useEffect,useRef,useState} from 'react';
export function useLectureProgressionNotice(plan={rows:[]},scope='',ready=true){
 const [notice,setNotice]=useState(''),previous=useRef(null);
 const rows=plan.rows||[],signature=rows.map(r=>`${r.id}:${r.targetOrder}`).join('|');
 useEffect(()=>{
  if(!ready)return;
  const next=new Map(rows.map(r=>[r.id,r.targetOrder]));
  if(previous.current?.scope===scope){
   const advanced=rows.filter(r=>r.targetOrder==='third-order'&&previous.current.next.get(r.id)==='second-order');
   const repair=rows.filter(r=>r.targetOrder==='second-order'&&previous.current.next.get(r.id)==='third-order');
   if(advanced.length)setNotice(`${advanced.length} objective${advanced.length===1?'':'s'} advanced to integration practice. See the objective targets below for the reason.`);
   else if(repair.length)setNotice(`${repair.length} objective${repair.length===1?'':'s'} returned to application to repair or test a connection.`);
  }else setNotice('');
  previous.current={scope,next};
 },[signature,scope,ready]); // eslint-disable-line react-hooks/exhaustive-deps
 return notice;
}
export function LectureProgression({plan={rows:[]},notice=''}){
 const [all,setAll]=useState(false);
 const rows=plan.rows||[];
 if(!rows.length)return null;
 const totals=['first-order','second-order','third-order'].map(order=>({order,attempts:rows.reduce((n,r)=>n+(r.orderLevels?.[order]?.attempts||0),0),correct:rows.reduce((n,r)=>n+(r.orderLevels?.[order]?.correct||0),0)}));
 const short=['Recognize','Apply','Integrate'];
 return <section aria-label="Lecture learning progression" className="my-3">
  {notice&&<p role="status" className="mb-2 text-sm font-semibold">↑ {notice}</p>}
  <details className="rounded-xl border border-border bg-bg-elevated px-4 py-2">
   <summary className="cursor-pointer py-1 text-sm"><span className="font-semibold">Recognition → Application → Integration</span><span className="ml-2 font-mono text-xs text-text-2">{totals.map((row,i)=>`${short[i]} ${row.attempts?`${row.correct}/${row.attempts}`:'—'}`).join(' · ')}</span></summary>
   <div className="mt-2 grid gap-2 sm:grid-cols-3">{totals.map((row,i)=><div key={row.order} className="rounded border border-border p-2"><h3 className="text-sm font-semibold">{['Recognize the concept','Apply a connection','Integrate connections'][i]}</h3><p className="mt-1 text-sm">{row.attempts?`${row.correct}/${row.attempts} independently correct`:'Not separately tested yet'}</p><p className="mt-1 text-xs text-text-3">{['Identify or distinguish a taught fact.','Use a taught relationship to interpret a new case.','Connect two necessary relationships to predict a new result.'][i]}</p></div>)}</div>
   <ul className="mt-2 space-y-2">{(all?rows:rows.slice(0,4)).map(row=><li key={row.id} className="border-t border-border pt-2 text-sm"><p>{row.text}</p><p className="text-xs text-text-2" title={row.progressionReason||''}>Next: <strong>{row.targetOrder==='third-order'?'Integration':'Application'}</strong>{row.state==='struggling'?' · ⚠ repair needed':''}</p></li>)}</ul>
   {rows.length>4&&<button type="button" className="mt-2 text-sm underline" onClick={()=>setAll(!all)}>{all?'Show fewer objectives':`Show all ${rows.length} objectives`}</button>}
   <p className="my-2 text-xs text-text-3">Only fresh, unhinted answers count. Advancement is a practice target, not a mastery claim.</p>
  </details>
 </section>;
}
