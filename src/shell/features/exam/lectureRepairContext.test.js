import {describe,it,expect} from 'vitest';
import {questionEvidenceKey} from '../../../stores/learnerEvidence.js';
import {buildLectureRepairContext} from './lectureRepairContext.js';
const objective = {id:'o',linkedLecId:'lec',objective:'Contrast the two sensory pathways',status:'struggling'};
const question = (id='q') => ({questionId:id,lectureId:'lec',stem:'Which pathway carries this sensation?',choices:{A:'Dorsal columns',B:'Spinothalamic tract'},correct:'A',objectiveIds:['o'],topic:'Sensory pathway distinction'});
const session = (id,correct,at,extra={}) => ({sessionId:id,status:'submitted',submittedAt:at,questions:[question(id)],answers:[{questionId:id,value:correct?'A':'B'}],...extra});
const build = (sessions,evidence={},objectives=[objective]) => buildLectureRepairContext(sessions,'lec',objectives,evidence);
describe('lecture repair handoff',()=>{
 it('targets 75 percent performance using the same 80 percent benchmark',()=>{
  const result=build([false,true,true,true].map((correct,i)=>session(`s${i}`,correct,i+1)));
  expect(result.focusObjectiveIds).toEqual(['o']);
  expect(result.weakObjectives[0]).toMatchObject({attempts:4,misses:1});
 });
 it('does not let a stale manual struggling label override 80 percent with a correct latest answer',()=>{
  expect(build([false,true,true,true,true].map((correct,i)=>session(`s${i}`,correct,i+1))).focusObjectiveIds).toEqual([]);
 });
 it('clears only the corrected question and retains a different unresolved concept',()=>{
  const other=session('other',false,2,{questions:[{...question('other'),stem:'Where does this pathway cross?',topic:'Decussation'}]});
  const result=build([session('old',false,1),other,session('retest',true,3)]);
  expect(result.missedQuestions).toHaveLength(1);
  expect(result.missedQuestions[0].stem).toBe('Where does this pathway cross?');
  expect(result.conceptsToReview).toEqual(['Decussation']);
 });
 it('uses answer chronology rather than input order or metadata updates',()=>{
  const old=session('old',false,1,{updatedAt:1000});
  expect(build([session('new',true,3),old]).missedQuestions).toEqual([]);
  expect(build([session('new',true,3),session('latest-miss',false,4),old]).missedQuestions).toHaveLength(1);
 });
 it('deduplicates correct retests even when option letters are shuffled',()=>{
  const retest=session('new',true,2,{questions:[{...question('new'),choices:{A:'Spinothalamic tract',B:'Dorsal columns'},correct:'B'}],answers:[{questionId:'new',value:'B'}]});
  expect(build([session('old',false,1),retest]).missedQuestions).toEqual([]);
 });
 it('ignores unsubmitted picks and uses only published checkpoint answers',()=>{
  const draft=session('draft',false,2,{status:'in_progress'});
  expect(build([draft]).focusObjectiveIds).toEqual([]);
  const checkpoint={...draft,progressSavedAt:3,checkpointAnswers:[{questionId:'draft',value:'A'}]};
  expect(build([checkpoint]).missedQuestions).toEqual([]);
  expect(build([checkpoint]).focusObjectiveIds).toEqual([]);
 });
 it('does not reintroduce answers previously excluded by quality protection',()=>{
  const saved=session('held',false,1,{status:'in_progress',progressSavedAt:2,checkpointAnswers:[{questionId:'held',value:'B'}],answers:[],scoringExcludedQuestionIds:['held']});
  expect(build([saved]).missedQuestions).toEqual([]);
  expect(build([saved]).focusObjectiveIds).toEqual([]);
 });
 it('uses durable recent recovery and respects explicit evidence withdrawal',()=>{
  const history=[session('old',false,1)];
  expect(build(history,{objectives:{o:{attempts:20,correct:8,recent:[true,true,true]}}}).focusObjectiveIds).toEqual([]);
  expect(build(history,{objectives:{o:{attempts:0,correct:0,recent:[]}}}).focusObjectiveIds).toEqual([]);
 });
 it('does not attribute a neighboring lecture objective from an erroneous question link',()=>{
  expect(build([session('miss',false,1)],{},[{...objective,linkedLecId:'other'}]).focusObjectiveIds).toEqual([]);
 });
 it('clears a saved-session miss after a later correct lecture-quiz answer to the same question',()=>{
  const evidence={evidenceJournal:[{lectureId:'lec',questionKey:questionEvidenceKey(`stem:${question().stem}`),at:3,correct:true}]};
  expect(build([session('old',false,1)],evidence).missedQuestions).toEqual([]);
  evidence.evidenceJournal[0].lectureId='other';
  expect(build([session('old',false,1)],evidence).missedQuestions).toHaveLength(1);
 });
 it('keeps resolved report topics out of the handoff',()=>{
  expect(buildLectureRepairContext([],'lec',[objective],{},[{concept:'Resolved report',masteryLevel:'mastered',tags:['exam-report'],linkedLecIds:['lec']}]).reportTopics).toEqual([]);
 });
});
