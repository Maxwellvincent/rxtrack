import {it,expect,afterEach} from 'vitest';
import {__setCloudBackendForTests,resetCloudStores,readCloud} from './cloudBase.js';
import {recordEvidenceBatchAwait,key} from './learnerEvidence.js';
import {installDomStorage} from './testEnv.js';
afterEach(()=>{resetCloudStores();__setCloudBackendForTests(null);});
it('merges against the current server journal instead of overwriting newer answers with a stale cached copy',async()=>{
 installDomStorage();const first={eventId:'first',questionKey:'q1',correct:false,at:1,lectureId:'l'},newer={eventId:'newer',questionKey:'q2',correct:true,at:2,lectureId:'l'};
 let server={evidenceJournal:[first,newer],evidenceBaseline:{}};
 __setCloudBackendForTests({doc:(_db,...path)=>path.join('/'),serverTimestamp:()=>1,onSnapshot:(ref,next)=>{next({exists:()=>true,data:()=>({data:ref.includes('learner-evidence')?{evidenceJournal:[first],evidenceBaseline:{}}:{}})});return()=>{};},runTransaction:async(_db,fn)=>fn({get:async()=>({exists:()=>true,data:()=>({data:server})}),set:(_ref,value)=>{server=value.data;}})});
 readCloud('u',key,{});
 await recordEvidenceBatchAwait('u',[{eventId:'last',questionKey:'q3',correct:true,at:3,lectureId:'l'}]);
 expect(server.evidenceJournal.map(e=>e.eventId)).toEqual(['first','newer','last']);const {read}=await import('./learnerEvidence.js');expect(read('u').lectures.l).toMatchObject({attempts:3,correct:2});expect(server.lectures).toBeUndefined();
});
