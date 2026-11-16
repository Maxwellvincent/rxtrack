import {describe,it,expect} from 'vitest';
import {readinessSnapshot,compareActual,choiceAuditIssues,randomAuditSample} from './readinessValidation.js';
const now=1000000;
const questions=Array.from({length:30},(_,i)=>({questionId:`q${i}`,lectureId:i<15?'l1':'l2',objectiveIds:[i<15?'o1':'o2'],sourceType:'question-bank',stem:`Unique clinical item ${i}`,choices:{A:'Yes',B:'No'},correct:'A'}));
const session=(id,qs,at)=>({sessionId:id,blockId:'b',status:'submitted',format:'exam',startedAt:at,submittedAt:at+100,deadline:at+100,questions:qs,answers:qs.map(q=>({questionId:q.questionId,value:'A'}))});
const args={blockId:'b',lectureIds:['l1','l2'],objectives:[{id:'o1',linkedLecId:'l1'},{id:'o2',linkedLecId:'l2'}],sessions:[session('s1',questions.slice(0,15),100),session('s2',questions.slice(15),300)],now};
describe('pre-test readiness evidence',()=>{
 it('requires broad fresh evidence before returning a provisional numeric proxy',()=>{
  expect(readinessSnapshot(args)).toMatchObject({total:30,estimatePercent:100,objectiveCoverage:1,sufficient:true});
  expect(readinessSnapshot({...args,lectureIds:['l1','l2','untested']})).toMatchObject({estimatePercent:null,sufficient:false});
  expect(readinessSnapshot({...args,sessions:[args.sessions[0]]}).estimatePercent).toBeNull();
 });
 it('excludes repeated, assisted, recovered, incomplete and quality-contested evidence',()=>{
  const s1=args.sessions[0],s2=args.sessions[1];
  expect(readinessSnapshot({...args,sessions:[s1,{...s2,timingRecovery:true}]}).excluded.recovered).toBe(15);
  expect(readinessSnapshot({...args,sessions:[s1,{...s2,targetQuestionCount:20}]}).excluded.incomplete).toBe(15);
  expect(readinessSnapshot({...args,sessions:[s1,{...s2,answers:s2.answers.map(a=>({...a,assisted:true}))}]}).excluded.assisted).toBe(15);
  expect(readinessSnapshot({...args,sessions:[s1,session('repeat',s1.questions,400)]}).excluded.repeated).toBe(15);
  const evidence={learningJournal:[{at:50,learningContext:{...questions[0],correctLetter:'A'}}]};
  expect(readinessSnapshot({...args,evidence}).total).toBe(29);
  expect(readinessSnapshot({...args,ratings:{bad:{evidenceKey:questions[0].questionId,excludeFromPerformance:true}}}).total).toBe(29);
 });
 it('uses lecture weights and counts unanswered valid timed questions as incorrect',()=>{
  const sessions=[args.sessions[0],{...args.sessions[1],answers:[]}];
  const snap=readinessSnapshot({...args,sessions,weights:{l1:1,l2:3}});
  expect(snap.estimatePercent).toBe(25);
  expect(snap.total).toBe(30);
 });
 it('compares a later school score without rewriting the prior estimate',()=>{
  const snap=readinessSnapshot(args),before=JSON.stringify(snap);
  const actual=compareActual(snap,{correct:40,total:50,takenAt:now+1});
  expect(actual).toMatchObject({percent:80,goalMet:true,errorPoints:-20,gapToGoal:0});
  expect(JSON.stringify(snap)).toBe(before);
  expect(()=>compareActual(snap,{correct:51,total:50,takenAt:now+1})).toThrow();
  expect(()=>compareActual(snap,{correct:40,total:50,takenAt:now-1})).toThrow(/after/);
 });
 it('detects key and choice corruption and preserves all source choices while sampling',()=>{
  expect(choiceAuditIssues({...questions[0],correct:'Z'})).toContain('Key does not point to a displayed choice');
  expect(choiceAuditIssues({...questions[0],choices:{A:' Same ',B:'same'}})).toContain('Duplicate answer choices');
  const before=JSON.stringify(questions);
  expect(randomAuditSample([...questions,questions[0]],10,()=>0.5)).toHaveLength(10);
  expect(JSON.stringify(questions)).toBe(before);
 });
});
