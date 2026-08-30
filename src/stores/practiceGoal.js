import {readCloud,writeCloudAwait,subscribeToCloudStore,isHydrated,readError} from './cloudBase.js';
import {readJson,writeJson} from './base.js';
const key='rxt-practice-goals-v1';
export const practiceGoalStore={
 read:uid=>uid?readCloud(uid,key,{}):readJson(uid,key,{}),
 write:(uid,data)=>uid?writeCloudAwait(uid,key,data):Promise.resolve(writeJson(uid,key,data)),
 subscribe:cb=>subscribeToCloudStore(key,cb),
 isHydrated:uid=>!uid||isHydrated(uid,key),
 readError:uid=>uid?readError(uid,key):null,
};
