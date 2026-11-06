import {readCloud,isHydrated as hydrated,readError as cloudError,subscribeToCloudStore,updateCloudAwait} from './cloudBase.js';
import {readJson,writeJson} from './base.js';
import {emptyStudyGuides,mergeStudyGuide} from '../engine/studyGuides.js';
export const keyFor=blockId=>`rxt-study-guides-v1:${blockId}`;
export const read=(userId,blockId)=>userId?readCloud(userId,keyFor(blockId),emptyStudyGuides()):readJson(null,keyFor(blockId),emptyStudyGuides());
export const isHydrated=(userId,blockId)=>!userId||hydrated(userId,keyFor(blockId));
export const readError=(userId,blockId)=>userId?cloudError(userId,keyFor(blockId)):null;
export const subscribe=(blockId,callback)=>subscribeToCloudStore(keyFor(blockId),callback);
export async function load(userId,blockId){
 const initial=read(userId,blockId);if(isHydrated(userId,blockId)){if(readError(userId,blockId))throw readError(userId,blockId);return initial;}
 return new Promise((resolve,reject)=>{let timer;const off=subscribe(blockId,()=>{if(!isHydrated(userId,blockId))return;clearTimeout(timer);off();const error=readError(userId,blockId);error?reject(error):resolve(read(userId,blockId));});timer=setTimeout(()=>{off();reject(new Error('Study sources have not synced yet. Please retry once connected.'));},5000);});
}
export async function save(userId,blockId,guide){
 const merge=current=>{const next=mergeStudyGuide(current,guide);if(new TextEncoder().encode(JSON.stringify(next)).length>850000)throw new Error('This block’s study-guide storage is full. No existing guide was removed.');return next;};
 if(userId)return updateCloudAwait(userId,keyFor(blockId),merge);
 const next=merge(read(null,blockId));writeJson(null,keyFor(blockId),next);return next;
}
