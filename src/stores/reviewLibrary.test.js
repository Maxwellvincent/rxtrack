import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {__setCloudBackendForTests,resetCloudStores} from './cloudBase.js';
import {installDomStorage} from './testEnv.js';
import {prepareReviewLibrary,saveLibrary,loadReviewContext,read} from './reviewLibrary.js';
const bridge=vi.hoisted(()=>vi.fn(async()=>null));vi.mock('../llmBridge.js',()=>({bridgeReviewLibrary:bridge}));
let documents,failAt,transactions;
beforeEach(()=>{installDomStorage();documents=new Map();failAt=0;transactions=0;bridge.mockClear();__setCloudBackendForTests({doc:(_db,...path)=>path.join('/'),serverTimestamp:()=>1,onSnapshot:(ref,next)=>{next({exists:()=>documents.has(ref),data:()=>documents.get(ref)});return()=>{};},runTransaction:async(_db,fn)=>{transactions++;const writes=[];const result=await fn({get:async ref=>({exists:()=>documents.has(ref),data:()=>documents.get(ref)}),set:(ref,value)=>writes.push([ref,value])});if(failAt===transactions)throw new Error('offline');writes.forEach(([r,v])=>documents.set(r,v));return result;}});});
afterEach(()=>{resetCloudStores();__setCloudBackendForTests(null);});
const payload=(suffix='a')=>({version:1,module:'NB2',packs:[{id:'p'+suffix,module:'NB2',sourceVersion:'v'+suffix,name:'review.pdf',sourcePath:'/PRIVATE_PATH',units:[{id:'u'+suffix,page:2,text:'Cerebellar lesion findings include impaired coordination and gait dysfunction.',kind:'review-teaching',method:'native'}]}]});
it('publishes bounded shards before a manifest and excludes local paths',()=>{
 const raw=payload();raw.packs[0].units=Array.from({length:12},(_,i)=>({id:String(i),page:i+1,text:'a'.repeat(30000)}));
 const prepared=prepareReviewLibrary('b',raw);expect(prepared.docs.length).toBeGreaterThan(1);expect(JSON.stringify(prepared)).not.toContain('PRIVATE_PATH');for(const doc of prepared.docs)expect(new TextEncoder().encode(JSON.stringify(doc.data)).length).toBeLessThan(250000);
});
it('retrieves cloud context without consulting the Mac or changing learner evidence',async()=>{
 await saveLibrary('user-cloud','nb2',payload('cloud'));bridge.mockClear();
 const result=await loadReviewContext('user-cloud','nb2',{module:'NB2',subject:'NB 37 Cerebellum',objectives:[{id:'o',text:'Describe cerebellar lesion findings'}]});
 expect(result.origin).toBe('account-cloud');expect(result.units).toHaveLength(1);expect(bridge).not.toHaveBeenCalled();expect([...documents.keys()].every(k=>k.includes('review-'))).toBe(true);
 expect((await loadReviewContext('other-user','nb2',{module:'NB2',subject:'NB 37 Cerebellum',objectives:[{id:'o',text:'Describe cerebellar lesion findings'}]})).units).toEqual([]);expect(read('user-cloud','other-block').ready).toBe(false);
});
it('never advertises a partially uploaded library as ready, and retries without losing prior data',async()=>{
 const raw=payload('retry');raw.packs[0].units=Array.from({length:12},(_,i)=>({id:String(i),page:i+1,text:'a'.repeat(30000)}));
 failAt=2;await expect(saveLibrary('retry-user','b',raw)).rejects.toThrow('offline');expect(read('retry-user','b').ready).toBe(false);
 failAt=0;await saveLibrary('retry-user','b',raw);expect(read('retry-user','b').ready).toBe(true);const before=transactions;await saveLibrary('retry-user','b',raw);expect(transactions).toBe(before);
});
it('rejects a different module before any cloud writes',()=>{expect(()=>prepareReviewLibrary('b',{...payload(),module:'NB1'})).toThrow();expect(documents.size).toBe(0);});
it('appends sources without discarding the migrated library and deduplicates reuploads',async()=>{
 const {addReviewPack}=await import('./reviewLibrary.js');
 await saveLibrary('append-user','nb2',payload('original'));
 await addReviewPack('append-user','nb2',{...payload('new').packs[0],name:'second.pdf'});
 expect(read('append-user','nb2').packs.map(p=>p.id)).toEqual(['poriginal','pnew']);
 await addReviewPack('append-user','nb2',{...payload('new').packs[0],name:'second.pdf'});
 expect(read('append-user','nb2').packs).toHaveLength(2);
 expect(read('append-user','nb2').totalUnits).toBe(2);
});

it('updates a changed review file with the same name without compounding sources',async()=>{
 const {addReviewPack}=await import('./reviewLibrary.js');
 await saveLibrary('version-user','nb2',payload('v1'));
 await addReviewPack('version-user','nb2',payload('v2').packs[0]);
 expect(read('version-user','nb2').packs.map(p=>p.id)).toEqual(['pv2']);
});
