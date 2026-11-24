// @vitest-environment jsdom
import {beforeAll,describe,it,expect} from 'vitest';
import {createUserWithEmailAndPassword,signInWithEmailAndPassword} from 'firebase/auth';
import {auth} from '../../../firebase.js';
import {installDomStorage} from '../../../stores/testEnv.js';
import {createExamSession,getExamSession,listLectureCheckpoints,updateExamSessionTransaction} from '../../../firebaseData.js';
import {createSessionShape} from '../../../examSessions.js';
import {checkpointExamSession,scoredSessionSnapshot} from '../exam/checkpoint.js';
import {finalizeExamSession} from '../exam/finalize.js';
import {lectureCheckpointResults} from './lectureCheckpointResults.js';
import * as evidence from '../../../stores/learnerEvidence.js';
import * as stats from '../../../stores/lectureQuestionStats.js';
import {sessionEvidenceEvent} from '../exam/sessionEvidence.js';

describe.skipIf(!globalThis.process?.env?.FIRESTORE_EMULATOR_HOST||!globalThis.process?.env?.FIREBASE_AUTH_EMULATOR_HOST)('independent lecture checkpoint account round trip',()=>{
 let uid;
 beforeAll(async()=>{installDomStorage();try{await createUserWithEmailAndPassword(auth,'checkpoint@demo.test','test1234');}catch{}uid=(await signInWithEmailAndPassword(auth,'checkpoint@demo.test','test1234')).user.uid;});
 it('saves, resumes without publishing answers, then submits once with a full denominator',async()=>{
  const id='independent-checkpoint',lectureId='checkpoint-lecture',blockId='checkpoint-block';
  const questions=Array.from({length:5},(_,i)=>({questionId:`cp-q${i}`,questionKey:`cp-key${i}`,blockId,lectureId,objectiveIds:['cp-objective'],sourceRelationshipIds:[`cp-connection${i}`],stem:`Controlled case ${i}: predict the response.`,choices:{A:'Response A',B:'Response B'},correct:'A',explanation:'Source relationship.'}));
  const session={...createSessionShape({sessionId:id,blockId,lectureIds:[lectureId],format:'exam',questions,durationMinutes:7.5,targetQuestionCount:5}),purpose:'lecture-checkpoint'};
  expect(session.startedAt).toBeNull();expect(session.deadline).toBeNull();
  await createExamSession(uid,session);
  await createExamSession(uid,{...session,sessionId:'ordinary-practice',purpose:'practice'});
  await createExamSession(uid,{...session,sessionId:'different-block',blockId:'other'});
  expect((await listLectureCheckpoints(uid,blockId,lectureId)).map(s=>s.sessionId)).toEqual([id]);
  const startedAt=Date.now(),deadline=startedAt+450000;
  await updateExamSessionTransaction(uid,id,s=>({...s,startedAt,deadline,answers:[{questionId:'cp-q0',value:'A',answeredAt:startedAt+1000,seq:1,writerId:'audit'},{questionId:'cp-q1',value:'B',answeredAt:startedAt+2000,seq:1,writerId:'audit'}]}));
  const paused=await checkpointExamSession(uid,id);
  expect(paused.deadline).toBe(deadline);expect(paused.answers).toHaveLength(2);expect(scoredSessionSnapshot(paused)).toBeNull();expect(evidence.read(uid).total).toBe(0);
  const resumed=await getExamSession(uid,id);expect(resumed.answers).toEqual(paused.answers);expect(resumed.deadline).toBe(deadline);
  expect(await finalizeExamSession(uid,id,{blockName:'Demo checkpoint'})).toEqual({ok:true});
  const final=await getExamSession(uid,id);expect(final.status).toBe('submitted');expect(lectureCheckpointResults(final)).toMatchObject({total:5,correct:1,unanswered:3,percent:20});
  expect(evidence.read(uid)).toMatchObject({total:2,correct:1});expect(stats.statsForLecture(uid,lectureId)).toMatchObject({answered:2,correct:1});
  expect(sessionEvidenceEvent(final,questions[0],final.answers[0])).toMatchObject({source:'lecture-checkpoint',objectiveIds:['cp-objective'],sourceRelationshipIds:['cp-connection0']});
  expect(await finalizeExamSession(uid,id,{blockName:'Demo checkpoint'})).toEqual({ok:true,alreadySubmitted:true});expect(evidence.read(uid).total).toBe(2);expect(stats.statsForLecture(uid,lectureId).answered).toBe(2);
 },30000);
});
