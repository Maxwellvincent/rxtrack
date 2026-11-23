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
 return <section aria-label="Lecture learning progression" className="my-4 rounded-xl border border-border bg-bg-elevated p-4">
  <h2 className="text-lg font-semibold">Recognition → Application → Integration</h2>
  <p className="mt-1 text-sm text-text-2">Your next target is set per objective. Difficulty such as “medium” is separate from reasoning depth. Application does not require completing every recognition question first.</p>
  {notice&&<p role="status" className="mt-2 text-sm font-semibold text-accent">{notice}</p>}
  <div className="mt-3 grid gap-2 sm:grid-cols-3">{totals.map((row,i)=><div key={row.order} className="rounded border border-border p-3"><h3 className="font-semibold">{['Recognize the concept','Apply a connection','Integrate connections'][i]}</h3><p className="mt-1 text-sm">{row.attempts?`${row.correct}/${row.attempts} independently correct`:'Not separately tested yet'}</p><p className="mt-1 text-xs text-text-3">{['Identify or distinguish a taught fact.','Use a taught relationship to interpret a new case.','Connect two necessary relationships to predict a new result.'][i]}</p></div>)}</div>
  <ul className="mt-3 space-y-2">{(all?rows:rows.slice(0,4)).map(row=><li key={row.id} className="border-t border-border pt-2 text-sm"><p className="font-semibold">{row.text}</p><p>Next: <strong>{row.targetOrder==='third-order'?'Integration':'Application'}</strong>{row.state==='struggling'?' · repair needed':''}</p><p className="text-xs text-text-3">{row.progressionReason}</p></li>)}</ul>
  {rows.length>4&&<button type="button" className="mt-2 text-sm underline" onClick={()=>setAll(!all)}>{all?'Show fewer objectives':`Show all ${rows.length} objectives`}</button>}
  <p className="mt-3 text-xs text-text-3">Counts are objective-linked evidence and can overlap. Hints and repeated questions do not count as fresh independent evidence. Advancement is a practice target, not a mastery claim.</p>
 </section>;
}
