import {useMemo,useState} from 'react';
import {lectureTrend} from '../../../engine/lectureTrend.js';
export function LectureProgressOverview({model={},ratings={},blockId,lectureId,stats={},objectivePractice={},relationshipRows=[],historyLoading=false}){
 const points=useMemo(()=>lectureTrend(model,{blockId,lectureId,ratings}),[model,blockId,lectureId,ratings]);const [metric,setMetric]=useState('accuracy');const [showAll,setShowAll]=useState(false);
 const rows=objectivePractice.rows || [],ready=rows.filter(r=>r.ready).length;
 const answered=Number(stats.answered)||0,accuracy=answered?Math.round(100*(Number(stats.correct)||0)/answered):null;
 const dated=points.reduce((s,p)=>s+p.answered,0);
 const due=relationshipRows.filter(r=>r.kind!=='figure'&&r.practiceState==='due').length,repair=relationshipRows.filter(r=>r.kind!=='figure'&&r.practiceState==='repair').length;
 return <section aria-label="Lecture progress overview" className="my-4 rounded-xl border border-border bg-bg-elevated p-4 sm:p-5">
 <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Your progress</h2><p className="mt-1 text-sm text-text-2">{stats.loading?'Loading question history…':`${answered} questions answered${accuracy!==null?` · ${accuracy}% correct`:''}`}</p></div><div className="flex gap-1 rounded-lg bg-panel p-1">{[['accuracy','Daily'],['runningAccuracy','Running average']].map(([key,label])=><button key={key} aria-pressed={metric===key} onClick={()=>setMetric(key)} className={`rounded px-3 py-2 text-sm ${metric===key?'bg-accent text-white':'text-text-2'}`}>{label}</button>)}</div></div>
 {(historyLoading||stats.loading)&&<p className="mt-2 text-xs text-text-3">History is syncing.</p>}
 {stats.error&&<p role="status" className="mt-2 text-xs text-bad">Question history could not sync; available history may be incomplete.</p>}
 <TrendChart points={points} metric={metric}/>
 <p className="text-xs text-text-3">{dated?`${dated} dated scored answers shown. ${metric==='accuracy'?'Each point is that day’s accuracy.':'Running average weights every dated answer equally.'}`:'Your first dated scored answer will start the trend.'}{answered>dated?' Only answers with usable dates and this lecture’s link are plotted.':''}</p>
 <div className="mt-5 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Objective understanding</h3>{rows.length>0&&<span className="text-sm text-text-2">{ready}/{rows.length} ready</span>}</div>
 {rows.length>0?<><ul className="mt-3 divide-y divide-border">{[...rows].sort((a,b)=>Number(a.ready)-Number(b.ready)||Number(b.state==='struggling')-Number(a.state==='struggling')).slice(0,showAll?rows.length:4).map(row=><li key={row.id} className="flex items-start justify-between gap-4 py-3 text-sm"><span>{row.text || row.code}</span><span className="shrink-0 text-right"><strong className={row.ready?'text-good':row.state==='struggling'?'text-bad':'text-text-2'}>{row.attempts?`${Math.round(100*row.correct/row.attempts)}%`:'Untested'}</strong><span className="block text-xs text-text-3">{row.ready?'Ready':row.state==='struggling'?'Needs repair':row.attempts?'Developing':''}{row.attempts?` · ${row.attempts} Qs`:''}</span></span></li>)}</ul>{rows.length>4&&<button className="mt-2 text-sm underline" onClick={()=>setShowAll(!showAll)}>{showAll?'Show priority objectives':`Show all ${rows.length} objectives`}</button>}</>:<p className="mt-2 text-sm text-text-2">Objective-linked answers will show where to focus.</p>}
 {(due>0||repair>0)&&<p className="mt-3 text-sm text-text-2">Fresh practice: {due} relationships due · {repair} to repair</p>}
 </div></section>;
}
function TrendChart({points,metric}){
 if(!points.length)return <div className="my-4 flex h-44 items-center justify-center rounded-lg bg-panel text-sm text-text-3">No dated question history yet</div>;
 const w=760,h=240,left=44,right=20,top=20,bottom=38;const ts=points.map(p=>Date.parse(p.day+'T12:00:00Z')),min=ts[0],span=ts.at(-1)-min;
 const x=i=>span?left+(ts[i]-min)/span*(w-left-right):w/2,y=v=>top+(100-v)/100*(h-top-bottom);
 const ticks=[0,20,40,60,80,100],label=p=>new Date(p.day+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
 return <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${metric==='accuracy'?'Daily':'Running average'} question accuracy by date; dashed target at 80 percent`} className="my-3 block w-full text-accent">
 {ticks.map(t=><g key={t}><line x1={left} x2={w-right} y1={y(t)} y2={y(t)} stroke="currentColor" opacity={t===80?0.65:0.12} strokeDasharray={t===80?'5 4':undefined}/><text x={left-8} y={y(t)+4} textAnchor="end" fontSize="11" fill="currentColor">{t}%</text></g>)}
 {points.length>1&&<polyline points={points.map((p,i)=>`${x(i)},${y(p[metric])}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>}
 {points.map((p,i)=><circle key={p.day} cx={x(i)} cy={y(p[metric])} r="5" fill="currentColor" tabIndex="0"><title>{label(p)}: {Math.round(p[metric])}% · {p.correct}/{p.answered} correct that day</title></circle>)}
 {[...new Set([0,Math.floor((points.length-1)/2),points.length-1])].map(i=><text key={i} x={x(i)} y={h-12} textAnchor="middle" fontSize="11" fill="currentColor">{label(points[i])}</text>)}
 </svg>;
}
