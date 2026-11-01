import {expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBenchmarkReportWriter,benchmarkRequestSignal} from '../../scripts/lib/benchmarkReport.js';
it('serializes overlapping updates and protects the final snapshot from late callbacks',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rxt-audit-'));
 try{
  const path=join(dir,'report.json');const write=createBenchmarkReportWriter(path);
  await Promise.all([write({stage:'draft'}),write({stage:'review'}),write({accepted:2},{final:true}),write({stage:'late timeout'})]);
  expect(JSON.parse(await readFile(path,'utf8'))).toEqual({accepted:2});
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('propagates preparation cancellation to the provider request',()=>{
 const controller=new AbortController();const signal=benchmarkRequestSignal(10000,{signal:controller.signal});
 controller.abort(new Error('Preparation ended'));
 expect(signal.aborted).toBe(true);expect(signal.reason.message).toBe('Preparation ended');
});
