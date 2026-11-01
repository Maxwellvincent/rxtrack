import { writeFile, rename } from 'node:fs/promises';

/** Serialize snapshots and publish atomically; late provider callbacks cannot replace a final report. */
export function createBenchmarkReportWriter(path) {
 let queue=Promise.resolve();
 let finalized=false;
 return (report,{final=false}={})=>{
  if(finalized)return queue;
  if(final)finalized=true;
  const text=JSON.stringify(report,null,2);
  queue=queue.then(async()=>{const temporary=`${path}.pending`;await writeFile(temporary,text);await rename(temporary,path);});
  return queue;
 };
}
export function benchmarkRequestSignal(remaining,options={}) {
 const timeout=Math.max(1,Math.ceil(Math.min(remaining,Number(options.timeoutMs)>0?Number(options.timeoutMs):remaining)));
 const signals=[AbortSignal.timeout(timeout),options.signal].filter(Boolean);
 return signals.length>1?AbortSignal.any(signals):signals[0];
}
