#!/usr/bin/env node
// Explicit live audit only. Saves a private report, never RXTrack study data.
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
const option=name=>process.argv[process.argv.indexOf(name)+1];
if(!process.argv.includes('--fixture')||!process.argv.includes('--output'))throw Error('Use --fixture private.json --output private-report.json');
const fixture=JSON.parse(await readFile(option('--fixture'),'utf8'));
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
let prepareObjectiveConnections,relationshipPages,parseBridgeJSON,connectionsStore,prepareObjectiveQuiz,mergeSourceRelationships,validSourceRelationships;
try{if(process.argv.includes('--questions')){connectionsStore=await server.ssrLoadModule('/src/stores/sourceRelationships.js');({prepareObjectiveQuiz}=await server.ssrLoadModule('/src/shell/features/objectives/quizLaunch.js'));}
({prepareObjectiveConnections}=await server.ssrLoadModule('/src/engine/objectiveConnections.js'));({relationshipPages,mergeSourceRelationships,validSourceRelationships}=await server.ssrLoadModule('/src/engine/sourceRelationships.js'));({parseBridgeJSON}=await server.ssrLoadModule('/src/llmBridge.js'));}finally{await server.close();}
const objectives=fixture.objectives.slice(0,2),lectureId=fixture.lectureIdHint||objectives[0]?.linkedLecId||'audit-lecture',blockId=fixture.blockId||objectives[0]?.blockId||'audit-block';
const scope={blockId,lectureId,objectives:objectives.map(o=>({...o,blockId,linkedLecId:lectureId})),pages:fixture.sourcePages||relationshipPages({},fixture.lectureText)};
const start=Date.now(),calls=[];let bundles=[],error;const count=process.argv.includes('--count')?Number(option('--count')):2;
const request=async(system,prompt,_fallback,maxTokens,_provider,_temp,options={})=>{
 const call={stage:/Independently check/.test(system)?'map-review':/learning path/.test(system)?'map-draft':'question',startedAt:Date.now()};calls.push(call);
 const response=await fetch('http://127.0.0.1:4319/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({system,prompt,json:true,maxTokens,timeoutMs:90000,purpose:'lecture-questions',modelTier:options.bridgeModelTier||'quality'}),signal:AbortSignal.timeout(95000)});
 const body=await response.json();if(!response.ok)throw Error(typeof body.error==='string'?body.error:`Bridge HTTP ${response.status}`);
 call.seconds=(Date.now()-call.startedAt)/1000;call.backend=body.backend;
 const result=parseBridgeJSON(body.text);call.result=result;options.signal?.throwIfAborted();return result;
};let questionResult;
try{
 if(process.argv.includes('--map-report')){
  const saved=JSON.parse(await readFile(option('--map-report'),'utf8'));bundles=saved.bundles;
  const valid=validSourceRelationships(mergeSourceRelationships({},bundles),scope);
  if(valid.length!==bundles.length)throw Error('Saved audit map does not match the current lecture/objective source.');
 }else bundles=await prepareObjectiveConnections(scope,request);
 if(process.argv.includes('--questions')&&bundles.length){
  const cells=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>cells.get(key)||null,setItem:(key,value)=>cells.set(key,value),removeItem:key=>cells.delete(key)}});
  await connectionsStore.save(null,lectureId,bundles);
  const target=bundles[0].relationship;
  const evidenceModel=process.argv.includes('--delayed')?{learningJournal:bundles.map((bundle,index)=>({blockId,lectureId,objectiveIds:[bundle.relationship.objectiveId],sourceRelationshipIds:[bundle.relationship.id],relationshipSourceVersion:bundle.relationship.sourceVersion,questionKey:`SIMULATED-${index}`,sessionKey:'SIMULATED-PRIOR-SESSION',at:Date.now()-25*60*60*1000,correct:true,reasoningVerified:true,orderLevel:'second-order'}))}:{};
  questionResult=await prepareObjectiveQuiz({...fixture,userId:null,blockId,lectureIdHint:lectureId,sourcePages:scope.pages,questionCount:count,plannedCount:count,evidenceModel,objectives:scope.objectives.map(o=>({...o,_transferOrder:process.argv.includes('--delayed')?'third-order':'second-order',_targetOrder:process.argv.includes('--delayed')?'third-order':'second-order',_connectionTargetIds:[target.id]})),reasoningPolicy:'challenge'},
   {callAIJSON:request,reviewAIJSON:request,repairAIJSON:request,maxPrepareAttempts:1,maxPreparationMs:180000,prepareConcurrency:1,blindSourceReview:true});
 }
}catch(e){error=e.message;}
await writeFile(option('--output'),JSON.stringify({elapsedSeconds:(Date.now()-start)/1000,scope,bundles,calls,questionResult,error,simulatedDelayedEvidence:process.argv.includes('--delayed'),studyDataChanged:false},null,2));
console.log(JSON.stringify({connections:bundles.length,questions:questionResult?.questions?.length,questionError:questionResult?.error,elapsedSeconds:(Date.now()-start)/1000,backends:calls.map(c=>c.backend),error,studyDataChanged:false}));
