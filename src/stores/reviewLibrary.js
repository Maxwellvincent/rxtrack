import {readCloud,isHydrated,readError,subscribeToCloudStore,updateCloudAwait} from './cloudBase.js';
import {stableRecordId} from '../engine/sourceUse.js';
import {selectReviewContext,reviewManifestKey} from '../../functions/review-sources.mjs';
const empty={version:1,ready:false,packs:[]},inFlight=new Map(),loaded=new Map();
export const read=(uid,block)=>uid?readCloud(uid,reviewManifestKey(block),empty):empty;
export const subscribe=(block,fn)=>subscribeToCloudStore(reviewManifestKey(block),fn);
async function loadRecord(uid,key,fallback){
 const initial=readCloud(uid,key,fallback);if(isHydrated(uid,key)){if(readError(uid,key))throw readError(uid,key);return initial;}
 return new Promise((resolve,reject)=>{let timer;const off=subscribeToCloudStore(key,()=>{if(!isHydrated(uid,key))return;clearTimeout(timer);off();const e=readError(uid,key);e?reject(e):resolve(readCloud(uid,key,fallback));});timer=setTimeout(()=>{off();reject(new Error('Review sources have not synced.'));},10000);});
}
export function prepareReviewLibrary(blockId,payload){
 if(payload?.version!==1||payload.module!=='NB2'||!Array.isArray(payload.packs)||payload.packs.length>30)throw new Error('Invalid NB2 review library.');
 const docs=[],packs=[];let bytes=0,totalUnits=0;
 for(const pack of payload.packs){
  if(pack.module!=='NB2'||typeof pack.id!=='string'||typeof pack.sourceVersion!=='string'||typeof pack.name!=='string'||!Array.isArray(pack.units)||pack.units.length>3000)throw new Error('Invalid review source metadata.');
  const units=pack.units.map(u=>{
   if(typeof u.id!=='string'||typeof u.text!=='string'||u.text.length>40000||!Number.isInteger(u.page)||u.page<1||u.page>1000)throw new Error('Invalid review page.');
   // Deliberately exclude sourcePath and unknown private machine metadata.
   const row={id:u.id,page:u.page,text:u.text,held:u.held===true,requiresFigure:u.requiresFigure===true,kind:String(u.kind || 'review-teaching'),keyStatus:'unverified'};
   for(const key of ['matchText','method','holdReason'])if(typeof u[key]==='string')row[key]=u[key];
   if(Number.isFinite(u.confidence))row.confidence=u.confidence;
   if(Array.isArray(u.scopes))row.scopes=u.scopes.filter(v=>typeof v==='string').slice(0,100);
   return row;
  });
  totalUnits+=units.length;const revision=stableRecordId(JSON.stringify(units),'revision'),keys=[];let part=[],size=0;
  const flush=()=>{if(!part.length)return;const key=`rxt-review-pages-v1:${blockId}:${revision}:${keys.length}`;docs.push({key,data:{version:1,blockId,revision,units:part}});keys.push(key);part=[];size=0;};
  for(const u of units){const n=new TextEncoder().encode(JSON.stringify(u)).length;bytes+=n;if(bytes>10_000_000)throw new Error('Review library exceeds its safe storage limit.');if(size+n>240000)flush();part.push(u);size+=n;}flush();
  packs.push({id:pack.id,name:pack.name,module:'NB2',sourceVersion:pack.sourceVersion,revision,keys,count:units.length});
 }
 if(!totalUnits)throw new Error('No review pages are available to sync.');
 const revision=stableRecordId(JSON.stringify(packs),'library');
 return {docs,manifest:{version:1,ready:true,blockId,module:'NB2',revision,packs,totalUnits,syncedAt:Date.now()}};
}
export async function saveLibrary(uid,block,payload){
 if(!uid||!block)throw new Error('Sign in before syncing review sources.');
 const prepared=prepareReviewLibrary(block,payload),current=await loadRecord(uid,reviewManifestKey(block),empty);
 if(current.ready&&current.revision===prepared.manifest.revision)return current;
 // Immutable, bounded shards land first; only then publish their manifest.
 for(const doc of prepared.docs)await updateCloudAwait(uid,doc.key,old=>old?.revision===doc.data.revision?old:doc.data);
 const manifest=await updateCloudAwait(uid,reviewManifestKey(block),()=>prepared.manifest);loaded.delete(`${uid}:${block}`);return manifest;
}
export async function ensureReviewLibrary(uid,block){
 if(!uid||!block)return empty;const key=`${uid}:${block}`;if(inFlight.has(key))return inFlight.get(key);
 const operation=(async()=>{const current=await loadRecord(uid,reviewManifestKey(block),empty);if(current.ready)return current;
  const {bridgeReviewLibrary}=await import('../llmBridge.js');const payload=await bridgeReviewLibrary();if(!payload)return current;
  return saveLibrary(uid,block,payload);
 })();inFlight.set(key,operation);try{return await operation;}finally{inFlight.delete(key);}
}
export async function loadReviewContext(uid,block,input){
 if(input.module!=='NB2')return {status:'outside-module',units:[]};
 if(!input.objectives?.length)return {status:'no-objectives',units:[]};
 const manifest=await ensureReviewLibrary(uid,block);if(!manifest.ready)return {status:'not-synced',units:[]};
 if(manifest.blockId!==block||manifest.module!=='NB2')throw new Error('Review library scope mismatch.');
 const cacheKey=`${uid}:${block}`,cached=loaded.get(cacheKey);let packs;
 if(cached?.revision===manifest.revision)packs=cached.packs;
 else{packs=await Promise.all(manifest.packs.map(async pack=>({...pack,units:(await Promise.all(pack.keys.map(async key=>{
  const doc=await loadRecord(uid,key,null);if(!doc||doc.blockId!==block||doc.revision!==pack.revision)throw new Error('Review page sync is incomplete.');return doc.units;
 }))).flat()})));loaded.set(cacheKey,{revision:manifest.revision,packs});}
 return {...selectReviewContext(packs,input),origin:'account-cloud',revision:manifest.revision};
}

/** Append or update one source without replacing other sources or learner data. */
export async function addReviewPack(uid,block,pack){
 if(!uid||!block)throw new Error('Sign in before uploading review sources.');
 const prepared=prepareReviewLibrary(block,{version:1,module:'NB2',packs:[pack]});
 for(const doc of prepared.docs)await updateCloudAwait(uid,doc.key,old=>old?.revision===doc.data.revision?old:doc.data);
 const manifest=await updateCloudAwait(uid,reviewManifestKey(block),old=>{
  const prior=old?.ready?old.packs:[];
  const sourceName=pack.name.trim().toLowerCase();
  const packs=[...prior.filter(p=>p.id!==pack.id&&p.name.trim().toLowerCase()!==sourceName),prepared.manifest.packs[0]];
  if(packs.length>30)throw new Error('This block supports up to 30 review sources.');
  return {...prepared.manifest,packs,totalUnits:packs.reduce((n,p)=>n+p.count,0),revision:stableRecordId(JSON.stringify(packs),'library')};
 });loaded.delete(`${uid}:${block}`);return manifest;
}
