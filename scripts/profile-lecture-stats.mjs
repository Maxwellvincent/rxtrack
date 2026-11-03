// Synthetic in-memory profile only: no account access, network requests or study writes.
import {createServer} from 'vite';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
try{
 const cloud=await server.ssrLoadModule('/src/stores/cloudBase.js');
 const stats=await server.ssrLoadModule('/src/stores/lectureQuestionStats.js');
 const entries=5000,iterations=50,user='synthetic-profile';
 const docs=new Map();
 docs.set(`users/${user}/kv/rxt-lecture-qstats`,{});
 docs.set(`users/${user}/kv/rxt-question-ratings-v1`,{ratings:{}});
 docs.set(`users/${user}/kv/rxt-learner-evidence-v1`,{evidenceJournal:Array.from({length:entries},(_,i)=>({eventId:`synthetic-${i}`,questionKey:`q-${i}`,lectureId:`lecture-${i%40}`,correct:i%3!==0,pendingLectureStats:true}))});
 cloud.__setCloudBackendForTests({doc:(_db,...parts)=>parts.join('/'),onSnapshot:(path,next)=>{next({exists:()=>docs.has(path),data:()=>({data:docs.get(path)}),metadata:{fromCache:true}});return ()=>{};},setDoc:()=>{throw new Error('Profile must not write');},serverTimestamp:()=>0});
 stats.read(user);
 const start=performance.now();let result;
 for(let i=0;i<iterations;i++)result=stats.read(user);
 const report={fixture:'5000 synthetic pending events / 40 lectures',iterations,totalMs:performance.now()-start,answered:Object.values(result).reduce((n,row)=>n+row.answered,0)};
 console.log(JSON.stringify(report));
 const output=process.argv[process.argv.indexOf('--output')+1];
 if(process.argv.includes('--output')&&output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
 cloud.resetCloudStores();
}finally{await server.close();}
