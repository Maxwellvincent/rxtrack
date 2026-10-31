import { describe, expect, it } from 'vitest';
import { questionProgress } from './questionProgress.js';
const session = (id, sourceType='question-bank') => ({sessionId:id, status:'submitted', sourceType,
  questions:[{questionId:'a',correct:'A',choices:{A:'Yes',B:'No'},lectureId:'lec1'}, {questionId:'b',correct:'A',choices:{A:'Yes',B:'No'}}],
  answers:[{questionId:'a',value:'A'}]});
describe('overall practice counter', () => {
  it('filters personal goals by date without changing lifetime totals',()=>{const ts=new Date(2026,7,30,12).getTime();const answers=[{ts,concept:'Lecture objective',correct:true},{ts:ts-8*86400000,concept:'Earlier',correct:true}];const s={...session('school'),submittedAt:ts};expect(questionProgress(answers,[s],{start:'2026-08-24',end:'2026-08-31'}).answered).toBe(2);expect(questionProgress(answers,[s]).answered).toBe(3);expect(questionProgress(answers,[s],{start:'2026-09-01',end:'2026-09-07'}).answered).toBe(0);});
  it('adds study, homework and exams once without counting unused slots', () => {
    const s = session('school');
    expect(questionProgress([{ts:1,concept:'Model',correct:false}], [s, s, session('exam','generated')])).toEqual({answered:3,correct:2,lectureAnswered:1,schoolAnswered:1,examAnswered:1,manualAnswered:0,gradedAnswered:3,accuracy:2/3});
  });
  it('adds manual outside-app logs to volume, but excludes them from accuracy', () => {
    const ts = new Date(2026, 8, 27, 12).getTime();
    const out = questionProgress([{ts,concept:'In-app',correct:true}], [], {}, [
      {id:'ipad-1',completedAt:ts,questionCount:25},
      {id:'older',completedAt:ts-86400000,questionCount:10},
    ]);
    expect(out).toMatchObject({answered:36,manualAnswered:35,gradedAnswered:1,correct:1,accuracy:1});
    expect(questionProgress([], [], {start:'2026-09-27',end:'2026-09-27'}, [{completedAt:ts,questionCount:25}]).answered).toBe(25);
  });
  it('counts repeat attempts, but not duplicate study-log copies', () => {
    const a={ts:1,concept:'Model',correct:true};
    expect(questionProgress([a,a,{...a,ts:2}], [session('first'),session('repeat')]).answered).toBe(4);
  });
  it('ignores drafts, abandoned sessions, invalid selections and orphan answers', () => {
    const s=session('s');
    s.answers=[{questionId:'a',value:null},{questionId:'b',value:'Z'},{questionId:'missing',value:'A'}];
    expect(questionProgress([], [s,{...session('draft'),status:'in_progress'},{...session('gone'),status:'abandoned'}]).answered).toBe(0);
  });
  it('counts only the final selection per question and recalculates after deletion', () => {
    const s=session('s');s.answers.push({questionId:'a',value:'B'});
    expect(questionProgress([], [s])).toMatchObject({answered:1,correct:0});
    expect(questionProgress([], [])).toMatchObject({answered:0,accuracy:null});
  });
});

it('uses saved per-answer dates so resaving homework does not move old work into today',()=>{
 const s={...session('homework'),submittedAt:200,answers:[{questionId:'a',value:'A',answeredAt:100},{questionId:'b',value:'B',answeredAt:200}]};
 expect(questionProgress([],[s],{startAt:150,endAt:250})).toMatchObject({answered:1,correct:0});
 expect(questionProgress([],[s],{startAt:50,endAt:150})).toMatchObject({answered:1,correct:1});
});
it('includes zero and positive self-reported scores but never assumes unknown scores are wrong',()=>{
 const entries=[{completedAt:10,questionCount:20,correctCount:16},{completedAt:10,questionCount:5,correctCount:0},{completedAt:10,questionCount:10},{completedAt:10,questionCount:3,correctCount:4}];
 expect(questionProgress([],[],{},entries)).toMatchObject({answered:38,manualAnswered:38,gradedAnswered:25,correct:16,accuracy:16/25});
});

it('does not collapse distinct questions sharing a timestamp and concept, or distinct retake sessions',()=>{
 const a={ts:100,concept:'Same objective',correct:true,questionKey:'q1',sessionKey:'first'};
 const b={...a,questionKey:'q2',correct:false};
 expect(questionProgress([a,a,b,{...a,sessionKey:'retake'}])).toMatchObject({answered:3,correct:2,gradedAnswered:3});
});
it('counts valid saved picks without a usable key as volume only',()=>{
 const s=session('unkeyed');s.questions[0].correct=null;
 expect(questionProgress([],[s])).toMatchObject({answered:1,schoolAnswered:1,gradedAnswered:0,correct:0,accuracy:null});
 s.questions[0].correct='Z';
 expect(questionProgress([],[s])).toMatchObject({answered:1,gradedAnswered:0,accuracy:null});
});
