// Synthetic data only; no account reads, model calls, or writes.
import {performance} from 'node:perf_hooks';
import {practiceAnswerHistory} from '../src/shell/features/exam/practiceAnswerHistory.js';import {recoverQuizHistory} from '../src/engine/recoverQuizHistory.js';
const n=1200,events=Array.from({length:n},(_,i)=>({source:'quiz',eventId:'a'+i,blockId:'b',lectureId:'l',sessionKey:'s'+Math.floor(i/20),questionKey:'q'+i,correct:i%4!==0,at:1000+i*2000,objectiveIds:['o'],learningContext:{topic:'Synthetic navigation benchmark '+i,detail:'Context '.repeat(50)}})),records=events.map(e=>({...e,ts:e.at})),ratings=Object.fromEntries(Array.from({length:25},(_,i)=>['r'+i,{evidenceKey:'unrelated'+i,excludeFromPerformance:true}]));
function time(name,fn){const t=performance.now();const r=fn();console.log(JSON.stringify({name,ms:Math.round((performance.now()-t)*10)/10,count:Array.isArray(r)?r.length:r.studyAnswers?.length}));}
time('answer history',()=>practiceAnswerHistory(records,{evidenceJournal:events},'b',['l'],ratings));time('history recovery',()=>recoverQuizHistory(records,events,{blockId:'b',lectures:[{id:'l',blockId:'b'}],objectives:[{id:'o',linkedLecId:'l'}],ratings}));
