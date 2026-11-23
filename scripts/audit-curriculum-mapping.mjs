#!/usr/bin/env node
// Explicit live curriculum audit. Private fixtures/results only; never writes study data.
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
const option=name=>process.argv[process.argv.indexOf(name)+1];
if(!process.argv.includes('--fixture')||!process.argv.includes('--output'))throw Error('Use --fixture private.json --output private-report.json');
const fixture=JSON.parse(await readFile(option('--fixture'),'utf8'));
const cells=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>cells.get(key)||null,setItem:(key,value)=>cells.set(key,value),removeItem:key=>cells.delete(key)}});
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
try{
const mapping=await server.ssrLoadModule('/src/engine/semanticObjectiveMapping.js');
const provider=mapping.createCurriculumReviewer({budgetUsd:2}),calls=[],results=[],started=Date.now();
const review=async(system,prompt,signal)=>{const at=Date.now(),context=JSON.parse(prompt);const result=await provider(system,prompt,signal);calls.push({seconds:(Date.now()-at)/1000,directorySize:context.directory?.length,candidates:context.candidates.map(c=>({id:c.lectureId,title:c.lectureTitle,characters:c.excerpt.length})),expanded:context.retrieval.expanded,result});return result;};
for(const question of fixture.questions){let evaluation;try{const result=await mapping.classifyObjectiveMapping(question,{...fixture,review,onEvaluation:value=>{evaluation=value;}});results.push({sourceQuestionId:question.sourceQuestionId,result,evaluation});console.log(JSON.stringify({question:question.sourceQuestionId,lectureId:result?.lectureId,objectiveIds:result?.objectiveIds,unresolved:!result}));}catch(error){results.push({sourceQuestionId:question.sourceQuestionId,error:error.message});}}
const report={seconds:(Date.now()-started)/1000,studyDataChanged:false,fixtureIdentity:'local original PDFs; audit-only IDs',calls,results};await writeFile(option('--output'),JSON.stringify(report,null,2));console.log(JSON.stringify({matched:results.filter(r=>r.result).length,total:results.length,seconds:report.seconds,studyDataChanged:false}));

}finally{await server.close();}
