import { blockBlueprintBanks } from "./blueprintScope.js";
import { useMemo, useState } from 'react';
import * as questionBanks from '../../../stores/questionBanks.js';
import * as questionBankMeta from '../../../stores/questionBankMeta.js';
import * as questionRatings from '../../../stores/questionRatings.js';
import { useStoreResource } from '../../hooks/useStoreResource.js';
import { buildBlueprintSourceCoverage, SOURCE_GROUPS } from './blueprintSourceCoverage.js';

export function SourceCoverageView({coverage,exam}) {
 const sources=coverage.groups.filter(g=>g.total);
 return <details open className="mt-4 rounded-lg border border-border bg-bg p-3">
  <summary className="cursor-pointer font-bold">How your school questions map to Test {exam}</summary>
  <p className="mt-2 text-sm text-text-2">{coverage.total} distinct imported questions · {coverage.mapped} mapped by subject · {coverage.unmapped} unresolved · {coverage.mixed} mixed or conflicting mappings</p>
  <p className="mt-1 text-xs text-text-3">Observed library mix is compared with the school blueprint; it does not change the target weights or predict this test. Repeated uploads count once in the pooled view.</p>
  <div className="mt-4 grid gap-3 sm:grid-cols-3">
   {coverage.rows.map(row=><div key={row.subject} className="rounded-lg border border-border p-3">
    <h5 className="text-sm font-bold">{row.label}</h5>
    <div className="mt-5 flex h-32 items-end justify-center gap-6" role="img" aria-label={`${row.label}: target ${row.range.join(' to ')} percent; observed ${row.observedShare==null?'no data':Math.round(row.observedShare)+' percent'}`}>
     <div className="relative h-full w-12"><div className="absolute bottom-0 w-full rounded-t bg-accent/30" style={{height:`${row.range[1]}%`}}/><div className="absolute w-full border-t-2 border-dashed border-accent" style={{bottom:`${row.range[0]}%`}}/></div>
     <div className="relative h-full w-12"><div className="absolute bottom-0 w-full rounded-t bg-accent" style={{height:row.observedShare==null?'2px':`${Math.max(1,row.observedShare)}%`}}/><span className="absolute inset-x-0 text-center text-xs font-bold" style={{bottom:`${Math.min(100,row.observedShare||0)}%`}}>{row.observedShare==null?'—':`${Math.round(row.observedShare)}%`}</span></div>
    </div>
    <div className="mt-1 flex justify-center gap-4 text-xs"><span>Target<br/>{row.range.join('–')}%</span><span>Library<br/>{row.questions} items</span></div>
    <p className="mt-2 text-sm">{row.gap} · {row.usable} usable items</p>
    <p className="text-xs text-text-3">{row.objectives} catalog objectives explicitly referenced; lecture-only mappings do not grant objective credit.</p>
   </div>)}
  </div>
  <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[30rem] text-left text-sm"><caption className="mb-2 text-left font-bold">Coverage by question source</caption><thead><tr><th className="p-2">Source</th>{coverage.rows.map(r=><th key={r.subject} className="p-2">{r.label}</th>)}<th className="p-2">Unresolved / mixed</th></tr></thead><tbody>{sources.map(source=><tr key={source.key} className="border-t border-border"><th className="p-2">{source.label}</th>{source.rows.map(row=><td key={row.subject} className="p-2">{row.questions} items · {row.observedShare==null?'—':`${Math.round(row.observedShare)}%`}<span className="block text-xs text-text-3">{row.usable} usable</span></td>)}<td className="p-2">{source.unmapped+source.mixed}</td></tr>)}</tbody></table></div>
  {!sources.length&&<p className="mt-2 text-sm">No imported school questions are available yet.</p>}
  <p className="mt-3 text-sm text-text-2">{coverage.missingFigures} missing required figures · {coverage.unusable} incomplete or excluded items · {coverage.otherSubjects} mapped to subjects without a specified weight for this test · {coverage.outsideCourse} explicitly from other BPM courses</p>
  <details className="mt-3 text-sm"><summary className="cursor-pointer">Per-file breakdown · {coverage.files.length} files</summary><ul className="mt-2 space-y-3">{coverage.files.map(file=><li key={file.filename} className="rounded border border-border p-2"><strong>{file.filename}</strong><span className="block text-xs text-text-3">{SOURCE_GROUPS[file.sourceGroup]} · {file.total} distinct items · {file.unmapped+file.mixed} unresolved / mixed</span>{file.rows.map(row=><span key={row.subject} className="mr-3 inline-block">{row.label}: {row.questions} ({row.observedShare==null?'—':`${Math.round(row.observedShare)}%`})</span>)}</li>)}</ul></details>
  <p className="mt-3 text-xs text-text-3">Percentages use all subject-mapped items in that source, including other subjects. Per-source counts may overlap when the same item appears in several sources. Exact objective codes and confirmed links take precedence; a clearly linked lecture is used only when its objectives all share one recognized discipline. Suggestions based on word overlap remain unresolved. Usable counts check the imported stem, choices, answer key and required image reference; they do not medically verify the key or test image downloads. Uncoded material can be classified by an explicit subject or clear lecture link, but that alone does not establish its test scope.</p>
 </details>;
}

function LoadedSourceCoverage({userId,blockId,exam,objectivesByLecture,lectures=[]}) {
 const banks=useStoreResource(questionBanks,userId), meta=useStoreResource(questionBankMeta,userId), ratings=useStoreResource(questionRatings,userId);
 const coverage=useMemo(()=>{
  const metadata=Object.values(meta.data||{});
  const sources=Object.entries(banks.data||{}).map(([filename,questions])=>{
   const entry=metadata.find(m=>m.filename===filename||m.aliases?.includes(filename));
   return {filename,questions,sourceKind:entry?.sourceKind||questions?.[0]?.sourceKind,displayName:entry?.displayName,
    blockId:entry?.blockId||questions?.find(q=>q.blockId)?.blockId};
  });
  return buildBlueprintSourceCoverage({exam,banks:blockBlueprintBanks(sources,blockId,lectures),objectivesByLecture,lectures,ratings:ratings.data?.ratings||{}});
 },[blockId,exam,banks.data,meta.data,ratings.data,objectivesByLecture,lectures]);
 if(banks.loading||meta.loading||ratings.loading)return <p role="status" className="mt-3 text-sm">Loading school question coverage…</p>;
 if(banks.error||meta.error||ratings.error)return <p role="alert" className="mt-3 text-sm">School question coverage could not sync. Your saved banks have not been changed.</p>;
 return <SourceCoverageView coverage={coverage} exam={exam}/>;
}

export function BlueprintSourceCoverage(props) {
 const [opened,setOpened]=useState(false);
 if(!opened)return <button type="button" onClick={()=>setOpened(true)} className="mt-4 rounded-lg border border-accent px-3 py-2 text-sm font-semibold text-accent">Compare homework, ExamSoft &amp; IMCQs</button>;
 return <LoadedSourceCoverage {...props}/>;
}
