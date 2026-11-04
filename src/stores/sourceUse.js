import {beginReservedAssessment} from '../engine/reservedAssessment.js';
import {readJson,writeJson} from './base.js';
import {readCloud,isHydrated as hydrated,readError as error,subscribeToCloudStore,updateCloudAwait} from './cloudBase.js';
import {emptySourceUse,reserveSource,recordSourceContext} from '../engine/sourceUse.js';
export const key='rxt-source-use-v1';
export const read=userId=>userId?readCloud(userId,key,emptySourceUse()):readJson(userId,key,emptySourceUse());
export const isHydrated=userId=>!userId || hydrated(userId,key);
export const readError=userId=>userId?error(userId,key):null;
export const subscribe=callback=>subscribeToCloudStore(key,callback);
const pendingChanges = new Map();
export async function change(userId,update){
 if(userId){
  // All quiz workers share one registry document. Queue this tab's writes to
  // avoid read/modify/write contention; each operation still reads fresh state.
  const previous=pendingChanges.get(userId) || Promise.resolve();
  const operation=previous.catch(()=>{}).then(()=>updateCloudAwait(userId,key,current=>update(current || emptySourceUse())));
  pendingChanges.set(userId,operation);
  try{return await operation;}finally{if(pendingChanges.get(userId)===operation)pendingChanges.delete(userId);}
 }
 const next=update(read(null));writeJson(null,key,next);return next;
}
export const reserve=(userId,filename,questions,reserved=true)=>change(userId,current=>reserveSource(current,filename,questions,reserved));
export async function context(userId,questions){
 let allowed=[];
 await change(userId,current=>{const result=recordSourceContext(current,questions);allowed=result.allowed;return result.registry;});
 return allowed;
}

export async function beginAssessment(userId,questions,history,sessionId,at){
 let snapshot;
 await change(userId,current=>{const result=beginReservedAssessment(current,questions,history,sessionId,at);snapshot=result.snapshot;return result.registry;});
 return snapshot;
}
