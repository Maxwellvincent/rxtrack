import {readCloud,isHydrated as hydrated,readError as error,subscribeToCloudStore,updateCloudAwait} from './cloudBase.js';
import {readJson,writeJson} from './base.js';
import {emptyRelationships,mergeSourceRelationships} from '../engine/sourceRelationships.js';
export const keyFor=lectureId=>`rxt-source-relationships-v1:${lectureId}`;
export const read=(userId,lectureId)=>userId?readCloud(userId,keyFor(lectureId),emptyRelationships()):readJson(null,keyFor(lectureId),emptyRelationships());
export const isHydrated=(userId,lectureId)=>!userId || hydrated(userId,keyFor(lectureId));
export const readError=(userId,lectureId)=>userId?error(userId,keyFor(lectureId)):null;
export const subscribe=(lectureId,callback)=>subscribeToCloudStore(keyFor(lectureId),callback);
export async function save(userId,lectureId,bundles){
 if(!bundles.length)return read(userId,lectureId);
 if(userId)return updateCloudAwait(userId,keyFor(lectureId),current=>mergeSourceRelationships(current,bundles));
 const next=mergeSourceRelationships(read(null,lectureId),bundles);writeJson(null,keyFor(lectureId),next);return next;
}
