import { describe, it, expect } from 'vitest';
import { recordLectureNotes, lectureNotesRecommendation, modelWithNotesEvidence } from './lectureNotesReview.js';
import { DAY, gradeModel, selectDailyModels } from './modelRetrieval.js';
const input={lectureId:'l',blockId:'b',title:'Lecture',reference:'My drawing'};
const weak={id:'o',text:'Describe the course and branches of the facial nerve',attempts:4,correct:1,ready:false};
describe('lecture notes completion and review',()=>{
 it('records explicit completion once, keeps references, and enrolls for tomorrow',()=>{
  const initial={settings:{},models:{}};
  const data=recordLectureNotes(initial,input,1000,'event');
  const model=Object.values(data.models)[0];
  expect(model).toMatchObject({lectureId:'l',reference:'My drawing',notesCompletedAt:1000,nextReviewAt:1000+DAY});
  expect(recordLectureNotes(data,input,1000,'event')).toEqual(data);
  expect(model.notesCompletions).toHaveLength(1);
  expect(model.history).toEqual([]);
 });
 it('preserves retrieval history and notes when logging an update without a replacement',()=>{
  let data=recordLectureNotes({settings:{},models:{}},input,1000,'a');
  const id=Object.keys(data.models)[0];
  data.models[id]=gradeModel(data.models[id],'solid',1000+DAY,'review');
  data=recordLectureNotes(data,{...input,reference:''},1000+2*DAY,'b');
  expect(data.models[id].history).toHaveLength(1);
  expect(data.models[id].notesCompletions).toHaveLength(2);
  expect(data.models[id].reference).toBe('My drawing');
 });
 it('suggests a targeted redraw and separates unknown coverage from low scores',()=>{
  const advice=lectureNotesRecommendation([weak,{id:'new',text:'Explain a receptor',attempts:0,correct:0}],{});
  expect(advice.task).toContain('Redraw');
  expect(advice).toMatchObject({weak:1,untested:1,ready:0,accuracy:25});
  expect(advice.targets.map(o=>o.id)).toEqual(['o']);
  expect(lectureNotesRecommendation([{id:'new',attempts:0,correct:0}]).instruction).toContain('not that you failed');
 });
 it('surfaces a new linked miss once, respects opt-out, and keeps the daily review budget',()=>{
  const model=Object.values(recordLectureNotes({settings:{},models:{}},input,1000,'a').models)[0];
  const evidence={objectives:{o:{lastSeen:2000,recent:[false]}}};
  const projected=modelWithNotesEvidence(model,[weak],evidence,3000);
  expect(projected.nextReviewAt).toBe(3000);
  expect(selectDailyModels([projected],{},3000,'b').selected).toHaveLength(1);
  expect(modelWithNotesEvidence(model,[weak],evidence,3000,false).nextReviewAt).toBe(model.nextReviewAt);
  const graded=gradeModel(projected,'solid',3000,'review');
  expect(modelWithNotesEvidence(graded,[weak],evidence,4000).nextReviewAt).toBe(graded.nextReviewAt);
  expect(selectDailyModels([graded],{},4000,'b').selected).toHaveLength(0);
 });
});
