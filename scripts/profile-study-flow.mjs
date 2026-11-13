// Synthetic only: no account reads, writes, or model calls.
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {repairTransferPlan} from '../src/engine/repairTransfer.js';
import {reconcileLectureStats} from '../src/shell/features/exam/reconcileLectureStats.js';
const lectures=Array.from({length:80},(_,i)=>({id:`l${i}`,blockId:'nb2'}));
const objectives=Array.from({length:320},(_,i)=>({id:`o${i}`,linkedLecId:`l${i%80}`,blockId:'nb2'}));
const events=Array.from({length:12000},(_,i)=>({at:1000+i,questionKey:`q${i}`,sessionKey:`s${Math.floor(i/20)}`,blockId:'nb2',lectureId:`l${i%80}`,objectiveIds:[`o${i%320}`],correct:i%4!==0,reasoningVerified:true,orderLevel:'second-order',learningContext:{topic:`Connection ${i%320}`}}));
for(const [name,run] of [['repair projection',()=>repairTransferPlan(objectives,{learningJournal:events},[],1000000)],['lecture reconciliation',()=>reconcileLectureStats({},[],lectures,'nb2',events)]]){
 const samples=[];let result;for(let i=0;i<8;i++){const t=performance.now();result=run();samples.push(performance.now()-t);}
 console.log(JSON.stringify({name,medianMs:+samples.sort((a,b)=>a-b)[4].toFixed(2),digest:createHash('sha256').update(JSON.stringify(result)).digest('hex'),rows:Array.isArray(result)?result.length:Object.keys(result).length}));
}
