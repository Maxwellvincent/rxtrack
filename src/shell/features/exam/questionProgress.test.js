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
