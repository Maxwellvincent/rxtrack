import {beforeEach,afterEach,it,expect} from 'vitest';
import {installDomStorage} from './testEnv.js';
import {__setCloudBackendForTests,resetCloudStores} from './cloudBase.js';
import * as sourceUse from './sourceUse.js';
import * as relationships from './sourceRelationships.js';
import {sourceItemId} from '../engine/sourceUse.js';
import {createSourceRelationship} from '../engine/sourceRelationships.js';
let documents,queue,rejectNext;
beforeEach(()=>{
 installDomStorage();documents=new Map();queue=Promise.resolve();rejectNext=false;
 __setCloudBackendForTests({doc:(_db,...path)=>path.join('/'),serverTimestamp:()=>1,
  onSnapshot:(ref,next)=>{next({exists:()=>documents.has(ref),data:()=>documents.get(ref)});return()=>{};},
  runTransaction:(_db,operation)=>{const result=queue.then(async()=>{
   const writes=[];const value=await operation({get:async ref=>({exists:()=>documents.has(ref),data:()=>documents.get(ref)}),set:(ref,value)=>writes.push([ref,value])});
   if(rejectNext){rejectNext=false;throw new Error('offline');}writes.forEach(([ref,value])=>documents.set(ref,value));return value;
  });queue=result.catch(()=>{});return result;}
 });
});
afterEach(()=>{resetCloudStores();__setCloudBackendForTests(null);});
const q=id=>({stem:`Unique original ${id}`,choices:{A:'First',B:'Second'},sourceFile:`${id}.pdf`});
it('keeps concurrent reservations and account scopes without optimistic success',async()=>{
 await Promise.all([sourceUse.reserve('u','a.pdf',[q('a')]),sourceUse.reserve('u','b.pdf',[q('b')])]);
 expect(Object.keys(sourceUse.read('u').items)).toHaveLength(2);
 expect(sourceUse.read('other').items).toEqual({});
 rejectNext=true;await expect(sourceUse.reserve('u','c.pdf',[q('c')])).rejects.toThrow('offline');
 expect(sourceUse.read('u').items[sourceItemId(q('c'))]).toBeUndefined();
});
it('rechecks a reservation atomically before permitting stale prepared context',async()=>{
 const captured=q('a');await sourceUse.reserve('u','a.pdf',[captured]);
 expect(await sourceUse.context('u',[captured])).toEqual([]);
 expect(sourceUse.read('u').items[sourceItemId(captured)].exposure).toBe('unknown');
});
it('merges source-backed records atomically per lecture without affecting learner stores',async()=>{
 const input={blockId:'b',lectureId:'lec',objective:{id:'o',objective:'Compare the two pathways'},clause:'two pathways',quote:'The supplied original evidence describes pathway relationships.',page:1,pages:[{page:1,text:'The supplied original evidence describes pathway relationships.'}]};
 const first=createSourceRelationship(input),second=createSourceRelationship({...input,objective:{id:'o2',objective:'Compare the two pathways'}});
 await Promise.all([relationships.save('u','lec',[first]),relationships.save('u','lec',[second])]);
 expect(Object.keys(relationships.read('u','lec').relationships)).toHaveLength(2);
 expect(relationships.read('u','other').relationships).toEqual({});
 expect([...documents.keys()].every(key=>key.includes('source-relationships'))).toBe(true);
});
