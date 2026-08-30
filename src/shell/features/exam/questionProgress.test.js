import { describe, expect, it } from 'vitest';
import { questionProgress } from './questionProgress.js';
const session = (id, sourceType='question-bank') => ({sessionId:id, status:'submitted', sourceType,
  questions:[{questionId:'a',correct:'A',choices:{A:'Yes',B:'No'},lectureId:'lec1'}, {questionId:'b',correct:'A',choices:{A:'Yes',B:'No'}}],
  answers:[{questionId:'a',value:'A'}]});
describe('overall practice counter', () => {
  it('adds study, homework and exams once without counting unused slots', () => {
    const s = session('school');
    expect(questionProgress([{ts:1,concept:'Model',correct:false}], [s, s, session('exam','generated')])).toEqual({answered:3,correct:2,lectureAnswered:1,schoolAnswered:1,examAnswered:1,accuracy:2/3});
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
