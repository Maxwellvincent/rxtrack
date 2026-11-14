import {afterEach,expect,it} from 'vitest';
import {__setCloudBackendForTests,docPathFor,resetCloudStores} from './cloudBase.js';
import {key,read,recordEvidenceBatchAwait} from './learnerEvidence.js';
import {installDomStorage} from './testEnv.js';

afterEach(()=>{resetCloudStores();__setCloudBackendForTests(null);});

it('atomically moves an oversized answer journal into bounded shards without losing editable history',async()=>{
 installDomStorage();
 const docs=new Map();
 const refFor=(...path)=>path.join('/');
 __setCloudBackendForTests({
  doc:(_db,...path)=>refFor(...path),serverTimestamp:()=>1,
  onSnapshot:(ref,next)=>{const value=docs.get(ref);next({exists:()=>value!==undefined,data:()=>value,metadata:{fromCache:false,hasPendingWrites:false}});return()=>{};},
  runTransaction:async(_db,fn)=>fn({
   get:async ref=>{const value=docs.get(ref);return {exists:()=>value!==undefined,data:()=>value};},
   set:(ref,value)=>docs.set(ref,value),
  }),
 });
 const events=Array.from({length:620},(_,index)=>({
  eventId:`event-${index}`,questionKey:`question-${index}`,lectureId:'lecture',objectiveIds:['objective'],
  correct:false,at:index+1,learningContext:{topic:'Topic',note:`detail-${index}-`+'x'.repeat(1200)},
 }));
 await recordEvidenceBatchAwait('u',events);
 const mainRef=refFor(...docPathFor('u',key));
 const main=docs.get(mainRef).data;
 expect(main.evidenceShards.length).toBeGreaterThan(0);
 expect(new TextEncoder().encode(JSON.stringify(main)).length).toBeLessThan(800_000);
 expect(read('u').evidenceJournal).toHaveLength(620);
 resetCloudStores();
 expect(read('u').evidenceJournal).toHaveLength(620);

 await recordEvidenceBatchAwait('u',[{...events[0],correct:true}]);
 expect(read('u')).toMatchObject({total:620,correct:1});
 expect(read('u').evidenceJournal.filter(event=>event.eventId==='event-0')).toHaveLength(1);
 await recordEvidenceBatchAwait('u',[],{removeEventIds:['event-1']});
 expect(read('u').evidenceJournal).toHaveLength(619);
});
