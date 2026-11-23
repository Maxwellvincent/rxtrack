// @vitest-environment jsdom
import {describe,it,expect,beforeAll} from 'vitest';
import {createUserWithEmailAndPassword,signInWithEmailAndPassword} from 'firebase/auth';
import {doc} from 'firebase/firestore';
import {auth,db} from '../firebase.js';
import {__test} from '../supabase.js';
import {installDomStorage} from './testEnv.js';
import * as relationships from './sourceRelationships.js';
import {prepareObjectiveConnections} from '../engine/objectiveConnections.js';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)('connection map cloud round trip',()=>{
 let uid;
 beforeAll(async()=>{
  installDomStorage();try{await createUserWithEmailAndPassword(auth,'connections@demo.test','test1234');}catch{}
  uid=(await signInWithEmailAndPassword(auth,'connections@demo.test','test1234')).user.uid;
 });
 it('saves the reviewed map and prerequisite IDs to the account document without creating learner answers',async()=>{
  const objective={id:'o',blockId:'b',linkedLecId:'l',objective:'Explain motor pathway relationships.'};
  const quote='Upper motor neurons communicate with lower motor neurons.';
  let calls=0;const bundles=await prepareObjectiveConnections({blockId:'b',lectureId:'l',objectives:[objective],pages:[{page:1,text:quote}]},async()=>++calls===1?{connections:[{key:'a',objectiveId:'O1',clause:'motor pathway relationships',label:'Upper to lower motor connection',quote,page:1,kind:'text',explanation:'Follow the connection from the upper neuron to the lower neuron before predicting a motor consequence.',checkPrompt:'How does this connection link the upper and lower neurons?',prerequisites:[]}]}:{approvedKeys:['a']});
  await relationships.save(uid,'l',bundles);
  const saved=await __test.readDoc(doc(db,'users',uid,'kv',__test.encodeDocId(relationships.keyFor('l'))));
  const row=saved.relationships[bundles[0].relationship.id];
  expect(row.learning.audit.status).toBe('approved');expect(row.learning.explanation).toContain('upper neuron');expect(row.learning.prerequisiteIds).toEqual([]);
  expect(saved.learningJournal).toBeUndefined();expect(saved.relationships[row.id].sourceVersion).toBe(bundles[0].relationship.sourceVersion);
 });
});
