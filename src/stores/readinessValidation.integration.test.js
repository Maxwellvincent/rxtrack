// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {createUserWithEmailAndPassword} from 'firebase/auth';
import {doc,getDocFromServer} from 'firebase/firestore';
import {auth,db} from '../firebase.js';
import {encodeDocId} from '../idCodec.js';
import {freezeSnapshot,saveActual,key} from './readinessValidation.js';
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)('durable pre-test estimate and school result',()=>{
 it('reads back the locked estimate and actual comparison from authenticated Firestore',async()=>{
  const credential=await createUserWithEmailAndPassword(auth,`forecast-${Date.now()}@example.test`,'test-password-123');
  const uid=credential.user.uid;
  const data=await freezeSnapshot(uid,{name:'Future school exam',testAt:Date.now()+60000,blockId:'b',lectureIds:['l'],estimatePercent:83,goal:80,total:40,policy:'test-policy'});
  const frozen=data.snapshots[0];
  const ref=doc(db,'users',uid,'kv',encodeDocId(key));
  expect((await getDocFromServer(ref)).data().data.snapshots[0].estimatePercent).toBe(83);
  await saveActual(uid,frozen.id,{correct:40,total:50,takenAt:Date.now()});
  const stored=(await getDocFromServer(ref)).data().data.snapshots[0];
  expect(stored.estimatePercent).toBe(83);
  expect(stored.createdAt).toBe(frozen.createdAt);
  expect(stored.actual).toMatchObject({percent:80,goalMet:true,errorPoints:-3});
  await expect(saveActual(uid,frozen.id,{correct:50,total:50,takenAt:Date.now()})).rejects.toThrow(/already/);
 });
});
