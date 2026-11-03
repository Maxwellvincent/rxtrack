export function RelationshipRetestSummary({rows=[],loading=false,error=null}){
 if(loading || error || !rows.length)return null;
 const eligible=rows.filter(row=>row.kind!=='figure');
 if(!eligible.length)return null;
 const due=eligible.filter(row=>row.practiceState==='due').length;
 const repair=eligible.filter(row=>row.practiceState==='repair').length;
 const waiting=eligible.filter(row=>row.practiceState==='waiting');
 const next=waiting.length?Math.min(...waiting.map(row=>row.dueAt)):null;
 const delayed=eligible.filter(row=>row.delayedApplicationCorrect>0).length;
 return <section aria-label="Delayed relationship practice" className="my-3 rounded-lg border border-border bg-panel p-3 text-sm">
  <h3 className="font-semibold">Fresh retests</h3>
  <p className="mt-1 text-text-2">{due} due · {repair} to repair{next?` · next retest ${new Date(next).toLocaleDateString()}`:''}</p>
  <p className="mt-1 text-xs text-text-3">{delayed}/{eligible.length} registered relationships have delayed correct application evidence. Repeated questions do not count as fresh retests. This partial inventory does not establish mastery or predict an exam score.</p>
 </section>;
}
