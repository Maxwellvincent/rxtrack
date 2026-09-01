import {confidenceAnalytics,confidenceTrustMessage} from './confidenceAnalytics.js';
const pct=value=>value==null?'—':`${Math.round(value*100)}%`;
export function ConfidenceCalibration({records=[]}){
 const stats=confidenceAnalytics(records);
 return <details className="mb-4 rounded-xl border border-border bg-panel p-4">
  <summary className="cursor-pointer font-semibold">Confidence calibration · {stats.total} rated answers</summary>
  <p className="mt-3 text-sm font-semibold">{confidenceTrustMessage(stats)}</p>
  <div className="mt-4 grid grid-cols-5 gap-2" role="img" aria-label="Observed accuracy by confidence level">
   {stats.curve.map(row=><div key={row.level} className="flex min-w-0 flex-col items-center">
    <div className="relative flex h-36 w-full max-w-16 items-end overflow-hidden rounded border-2 border-border-strong bg-bg-elevated">
     <div className="absolute left-0 right-0 border-t-2 border-dashed border-text-2" style={{bottom:`${row.expected*100}%`}} title={`Expected ${pct(row.expected)}`}/>
     <div className="w-full bg-accent" style={{height:row.accuracy==null?0:`${row.accuracy*100}%`}}/>
    </div>
    <strong className="mt-2 text-sm">{pct(row.accuracy)}</strong><span className="text-center text-xs">{row.label}</span><span className="text-xs text-text-3">n={row.count}</span>
   </div>)}
  </div>
  <p className="mt-3 text-xs text-text-3">Solid bar = your observed accuracy. Dashed line = the confidence level you claimed. High confidence combines Confident + Certain.</p>
  <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded border border-border p-2"><span className="text-xs">High-confidence accuracy</span><strong className="block text-lg">{pct(stats.highAccuracy)}</strong></div><div className="rounded border border-border p-2"><span className="text-xs">Confident misses</span><strong className="block text-lg">{stats.landmines}</strong></div><div className="rounded border border-border p-2"><span className="text-xs">Calibration gap</span><strong className="block text-lg">{pct(stats.meanGap)}</strong></div></div>
  {stats.priorHighAccuracy!=null&&stats.recentHighAccuracy!=null&&<p className="mt-3 text-sm">Last 50 high-confidence accuracy: {pct(stats.recentHighAccuracy)} · previous 50: {pct(stats.priorHighAccuracy)}</p>}
 </details>;
}
