import { readCloud, writeCloudAwait, subscribeToCloudStore, isHydrated as hydrated, readError as error } from './cloudBase.js';
export const key='rxt-school-results';
export const read = uid => uid ? readCloud(uid,key,{}) : {};
export const write = (uid,value) => { if(!uid) throw new Error('Sign in to save school results.'); return writeCloudAwait(uid,key,value); };
export const subscribe = cb => subscribeToCloudStore(key,cb);
export const isHydrated = uid => hydrated(uid,key);
export const readError = uid => error(uid,key);
