import { readCloud, writeCloudAwait, subscribeToCloudStore, isHydrated, readError } from './cloudBase.js';
import { readJson, writeJson } from './base.js';
import { applyModelEvidence } from '../engine/modelRetrieval.js';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { studyDayKey } from '../studyDay.js';
import { appendActivity } from '../shell/logic/completionLog.js';
import { encodeDocId } from '../idCodec.js';
export const key='rxt-model-retrieval-v1';
const empty={version:1,settings:{},models:{}};
export const retrievalStore={
  read: userId => (userId ? readCloud(userId,key,empty) : readJson(userId,key,empty)) || empty,
  write: (userId,data) => userId ? writeCloudAwait(userId,key,data) : Promise.resolve(writeJson(userId,key,data)),
  subscribe: cb => subscribeToCloudStore(key,cb),
  isHydrated: userId => !userId || isHydrated(userId,key),
  readError: userId => userId ? readError(userId,key) : null,
  update: async (userId, transform) => {
    if (!userId) {const next=transform(retrievalStore.read(userId));writeJson(userId,key,next);return next;}
    // Read and enforce the daily budget atomically across devices/tabs.
    const ref=doc(db,'users',userId,'kv',encodeDocId(key));
    return runTransaction(db,async transaction=>{
      const snapshot=await transaction.get(ref);
      const next=transform(snapshot.exists()?snapshot.data().data:empty);
      transaction.set(ref,{data:next,updatedAt:serverTimestamp()});
      return next;
    });
  },
};
/** Integration seam: callers must supply an explicit model ID; never match by a guessed keyword.
 * Question/Anki adapters can call this after a reliable relationship mapping is available.
 */
export async function recordRetrievalEvidence(userId, modelId, event) {
  const data=retrievalStore.read(userId);
  if (!retrievalStore.isHydrated(userId)) throw new Error('Wait for model sync before recording evidence.');
  if (!data.models[modelId]) return false;
  await retrievalStore.update(userId,current=>{
    const model=current.models[modelId];
    if (!model) return current;
    return {...current,models:{...current.models,[modelId]:applyModelEvidence(model,event,current.settings)}};
  });
  return true;
}

/** One explicit slide-and-notes session, committed together without inferring older history. */
export async function recordCombinedLectureReview(userId, input, transform, at, eventId) {
  const completionKey = 'rxt-completion';
  const apply = (models, completion) => {
    const next = transform(models);
    const result = appendActivity(completion, { ...input, activityType:'review', reviewKind:'slides-notes',
      note:'Slides & notes review', now:new Date(at), id:eventId });
    const model=Object.values(next.models).find(item=>item.lectureId===input.lectureId && item.blockId===input.blockId);
    if (!model || !result) throw new Error('A linked lecture review is required.');
    const entry={...result.entry, reviewDates:model.nextReviewAt == null ? [] : [studyDayKey(new Date(model.nextReviewAt))]};
    return { models:next, completion:{...result.store,[result.key]:entry} };
  };
  if (!userId) {
    const next=apply(retrievalStore.read(userId),readJson(userId,completionKey,{}));
    writeJson(userId,key,next.models);writeJson(userId,completionKey,next.completion);return next.models;
  }
  const modelRef=doc(db,'users',userId,'kv',encodeDocId(key));
  const completionRef=doc(db,'users',userId,'kv',encodeDocId(completionKey));
  return runTransaction(db,async transaction=>{
    const models=await transaction.get(modelRef);
    const completion=await transaction.get(completionRef);
    const next=apply(models.exists()?models.data().data:empty,completion.exists()?completion.data().data:{});
    transaction.set(modelRef,{data:next.models,updatedAt:serverTimestamp()});
    transaction.set(completionRef,{data:next.completion,updatedAt:serverTimestamp()});
    return next.models;
  });
}
