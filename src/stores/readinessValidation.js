import {readCloud,updateCloudAwait,subscribeToCloudStore,isHydrated as hydrated,readError as error} from './cloudBase.js';
import {compareActual} from '../engine/readinessValidation.js';
export const key='rxt-readiness-validation-v1';
export const read=uid=>readCloud(uid,key,{snapshots:[],audits:[]});
export const subscribe=cb=>subscribeToCloudStore(key,cb);
export const isHydrated=uid=>!uid||hydrated(uid,key);
export const readError=uid=>uid?error(uid,key):null;
export async function freezeSnapshot(uid,snapshot){
 if(!snapshot.name?.trim()||!snapshot.lectureIds?.length||!Number.isFinite(snapshot.testAt)||snapshot.testAt<=Date.now())throw new Error('Choose a future test date, name and lecture scope.');
 return updateCloudAwait(uid,key,current=>{
  const data=current||{snapshots:[],audits:[]};
  if(data.snapshots.length>=40)throw new Error('Snapshot history is full. Export or review your existing tests before saving another.');
  return {...data,snapshots:[...data.snapshots,{...snapshot,id:crypto.randomUUID(),createdAt:Date.now()}]};
 });
}
export const saveActual=(uid,id,actual)=>updateCloudAwait(uid,key,current=>{
 const snapshot=current?.snapshots?.find(s=>s.id===id);
 if(!snapshot)throw new Error('Saved estimate not found.');
 if(snapshot.actual)throw new Error('This test already has a saved result.');
 const comparison=compareActual(snapshot,actual);
 if(actual.takenAt>Date.now())throw new Error('Actual test date cannot be in the future.');
 return {...current,snapshots:current.snapshots.map(s=>s.id===id?{...s,actual:{...comparison,recordedAt:Date.now()}}:s)};
});
export const saveAudit=(uid,audit)=>updateCloudAwait(uid,key,current=>({...current,snapshots:current?.snapshots||[],audits:[...(current?.audits||[]),audit].slice(-20)}));
