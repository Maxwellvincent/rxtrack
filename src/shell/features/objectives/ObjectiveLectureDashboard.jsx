import {useState} from 'react';
import {formatLectureLabel} from '../../../lectureTitle.js';
import {segments,segmentStyle} from './LectureProgressDashboard.jsx';

/** Six readable lectures at a time; filters only change ranking, never evidence. */
export function ObjectiveLectureDashboard({rows=[],title,description,metric='tested',metricLabel='covered',onStudy,onQuiz,objectives=[],blockId,children}){
 const [page,setPage]=useState(0),[selectedId,setSelectedId]=useState(null);
 const current=Math.min(page,Math.max(0,Math.ceil(rows.length/6)-1));
 const visible=rows.slice(current*6,current*6+6);
 const selected=visible.find(r=>r.lec.id===selectedId) || visible[0];
 return <section className="rounded-xl border border-border bg-panel p-4" aria-label={title}>
  <h3 className="text-lg font-bold">{title}</h3><p className="mt-1 text-sm text-text-2">{description}</p>
  <ul className="my-3 flex flex-wrap gap-4 text-xs" aria-label="Objective chart legend">{segments.map(s=><li key={s.key} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={segmentStyle(s)}/>{s.symbol} {s.label}</li>)}</ul>
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
   <p className="text-sm font-semibold" aria-live="polite">{rows.length?`Lectures ${current*6+1}–${current*6+visible.length} of ${rows.length}`:'No lectures match this view'}</p>
   {rows.length>6 && <div className="flex gap-2"><button type="button" disabled={current===0} onClick={()=>{setPage(current-1);setSelectedId(null);}} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40">← Previous six</button><button type="button" disabled={(current+1)*6>=rows.length} onClick={()=>{setPage(current+1);setSelectedId(null);}} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40">Next six →</button></div>}
  </div>
  <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Six lecture objective bars">{visible.map((row,i)=><button type="button" key={row.lec.id} aria-pressed={selected?.lec.id===row.lec.id} aria-label={`${formatLectureLabel(row.lec)}: ${row[metric]} ${metricLabel} of ${row.total} objectives`} onClick={()=>setSelectedId(row.lec.id)} className={`flex min-w-0 flex-col items-center rounded-xl border p-3 text-center ${selected?.lec.id===row.lec.id?'border-accent bg-accent/5 ring-2 ring-accent':'border-border bg-bg'}`}>
   <span className="text-xs font-semibold">#{current*6+i+1} · {row.lec.lectureType || 'LEC'} {row.lec.lectureNumber ?? ''}</span>
   <strong className="mt-2 text-base">{metric==='tested'?`${row.coverage}% covered`:`${row[metric]} ${metricLabel}`}</strong>
   <span className="text-xs text-text-2">{row.tested}/{row.total} seen</span>
   <span className="my-3 flex h-40 w-12 flex-col-reverse overflow-hidden rounded-t border border-border" aria-hidden="true">{segments.filter(s=>row[s.key]>0).map(s=><span key={s.key} style={{flex:`0 0 ${100*row[s.key]/row.total}%`,...segmentStyle(s)}}/>)}</span>
   <span className="line-clamp-3 w-full text-sm font-semibold" title={formatLectureLabel(row.lec)} style={{overflowWrap:'anywhere'}}>{row.lec.lectureTitle || row.lec.title || formatLectureLabel(row.lec)}</span>
   <span className="mt-auto pt-3 text-xs">{row.ut} without answer evidence · {row.st} need repair</span>
  </button>)}</div>
  {selected && <div className="mt-4 rounded-xl border border-border bg-bg p-4" aria-live="polite">
   <h4 className="font-bold">{formatLectureLabel(selected.lec)}</h4>
   <p className="mt-1 text-sm">{selected.tested}/{selected.total} seen · {selected.m} mastered · {selected.ip} in progress · {selected.st} struggling · {selected.ut} without answer evidence</p>
   <p className="mt-1 text-xs text-text-2">{selected.questionAttempts} linked question attempts. Coverage records answers; completion and mastery are tracked separately.</p>
   <div className="my-3 flex flex-wrap gap-2"><button type="button" disabled={!onStudy} onClick={()=>onStudy?.(selected.lec.id)} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white">Review lecture →</button><button type="button" disabled={!onQuiz} onClick={()=>onQuiz?.(objectives.filter(o=>o.linkedLecId===selected.lec.id),formatLectureLabel(selected.lec),blockId,{lectureId:selected.lec.id})} className="rounded-lg border border-accent px-4 py-2 font-semibold">Quiz lecture →</button></div>
   {children?.(selected)}
  </div>}
 </section>;
}
