import {it,expect} from 'vitest';
import {auditAnswerHistory} from './answerHistoryAudit.js';
import {applyEvidence,questionEvidenceKey} from '../stores/learnerEvidence.js';
const objectives=[{id:'o',code:'SOM.NB.1',status:'developing'},{id:'other'}];
const record={questionKey:'q',objectiveIds:['SOM.NB.1'],correct:false,ts:10000};
const run=(args={})=>auditAnswerHistory({blockId:'NB',objectives,calibration:[record],...args});
it('recovers explicit code links and is idempotent after replay',()=>{
 const first=run();expect(first.events).toHaveLength(1);expect(first.events[0].objectiveIds).toEqual(['o']);
 const evidence={...applyEvidence({},first.events[0]),evidenceJournal:first.events};
 expect(run({evidence}).events).toHaveLength(0);expect(evidence.objectives.o.attempts).toBe(1);
});
it('repairs existing unlinked answer instead of adding a second answer',()=>{
 const event={at:10000,blockId:'NB',questionKey:questionEvidenceKey('q'),objectiveIds:[],correct:false};
 const result=run({evidence:{evidenceJournal:[event]}});
 expect(result.events).toHaveLength(1);expect(result.summary.repairedLinks).toBe(1);expect(result.summary.recoveredAnswers).toBe(0);
});
it('never infers objective credit from review labels or unlinked answers',()=>{
 const result=run({calibration:[{...record,objectiveIds:[]} ]});
 expect(result.events).toEqual([]);expect(result.summary.needsLinking).toBe(1);expect(result.summary.legacyReviewedWithoutAnswers).toBe(1);
});
it('excludes disputed answers and foreign blocks, and retains unanswered questions as untested',()=>{
 const result=run({excluded:()=>true,sessions:[{sessionId:'s',blockId:'ER',status:'submitted',questions:[],answers:[]}]});
 expect(result.events).toEqual([]);expect(result.summary.excluded).toBe(1);
});
it('recovers school/exam answers only once and uses original session identity',()=>{
 const session={sessionId:'s',blockId:'NB',format:'practice',status:'submitted',questions:[{questionId:'q1',correct:'A',choices:{A:'One'},objectiveIds:['o'],sourceType:'question-bank'}],answers:[{questionId:'q1',value:'A',answeredAt:50}]};
 const result=run({calibration:[],sessions:[session]});expect(result.events[0]).toMatchObject({sessionKey:'s',correct:true,objectiveIds:['o']});
 expect(run({calibration:[],sessions:[session],evidence:{evidenceJournal:result.events}}).events).toEqual([]);
});
it('updates a legacy journal row in place and cannot double its grade on repeated audits',async()=>{
 const storage=new Map();Object.defineProperty(globalThis,'localStorage',{value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},configurable:true});
 const {recordEvidence,recordEvidenceBatchAwait,read}=await import('../stores/learnerEvidence.js');
 recordEvidence(null,{at:10000,blockId:'NB',questionKey:questionEvidenceKey('q'),objectiveIds:[],correct:false});
 const first=run({evidence:read(null)});await recordEvidenceBatchAwait(null,first.events);
 expect(read(null).total).toBe(1);expect(read(null).objectives.o.attempts).toBe(1);
 expect(run({evidence:read(null)}).events).toHaveLength(0);
});
it('reports unresolved records by original source and reason without grading them',()=>{
 const result=run({calibration:[{concept:'Unkeyed legacy recall',correct:true,ts:1}]});
 expect(result.origins[0]).toMatchObject({source:'Lecture-quiz answer log',needsLinking:1});
 expect(result.unresolved[0]).toMatchObject({reason:'Missing question identity',stem:'Unkeyed legacy recall',hasFullQuestion:false});
 expect(result.events).toEqual([]);
});
it('reconstructs identities and objective links from a saved source without copying large source text into evidence',()=>{
 const stem='A clinical case with enough distinguishing source text to identify the same saved question precisely without assuming that all lecture objectives were tested.';
 const result=run({calibration:[{stem:stem.slice(0,100),correct:false,ts:12}],sourceQuestions:[{id:'q',stem,objectiveIds:['o'],lectureId:'l',explanation:'large text',choices:{A:'Answer'}}]});
 expect(result.events[0]).toMatchObject({objectiveIds:['o'],correct:false});
 expect(result.events[0]).not.toHaveProperty('choices');expect(result.events[0]).not.toHaveProperty('explanation');
});
it('migrates a legacy bank key in place and does not combine q1 from different banks',()=>{
 const make=(sessionId,stem,objective)=>({sessionId,blockId:'NB',status:'submitted',format:'practice',questions:[{id:'q1',questionId:sessionId+':q1',sourceType:'question-bank',stem,choices:{A:'Answer',B:'Other'},correct:'A',objectiveIds:[objective]}],answers:[{questionId:sessionId+':q1',value:'A',answeredAt:100}]});
 const a=make('one','Question about glial cells and their roles','o'),b=make('two','Question about motor nerves and their roles','other');
 const old={eventId:'exam:one:one:q1',source:'school-practice',sessionKey:'one',blockId:'NB',questionKey:questionEvidenceKey('q1'),objectiveIds:['other'],correct:true,at:100};
 const result=run({calibration:[],sessions:[a,b],evidence:{evidenceJournal:[old]}});
 expect(result.events).toHaveLength(2);expect(result.events[0]).toMatchObject({eventId:old.eventId,objectiveIds:['o'],correct:true});
 expect(result.events[0].questionKey).not.toBe(result.events[1].questionKey);
 expect(run({calibration:[],sessions:[a,b],evidence:{evidenceJournal:result.events}}).events).toEqual([]);
});
