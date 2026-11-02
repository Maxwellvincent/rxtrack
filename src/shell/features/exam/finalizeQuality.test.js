import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({session:null,weak:{},remove:vi.fn(),record:vi.fn()}));
vi.mock('../../../supabase.js',()=>({updateExamSessionTransaction:async(_u,_id,update)=>{state.session=update(state.session)||state.session;return state.session;},getExamSession:async()=>state.session,listExamSessions:async()=>[]}));
vi.mock('../../../stores/questionFigures.js',()=>({read:()=>({}),apply:q=>q}));
vi.mock('../../../stores/questionRatings.js',()=>({read:()=>({ratings:{}})}));
vi.mock('../../../stores/lectureQuestionStats.js',()=>({recordAnswerAwait:vi.fn()}));
vi.mock('../../../stores/weakConcepts.js',()=>({read:async()=>state.weak,writeAwait:async(_u,next)=>{state.weak=next;}}));
vi.mock('../../../stores/learnerEvidence.js',()=>({recordEvidenceAwait:(...args)=>state.record(...args),recordEvidenceBatchAwait:(...args)=>state.remove(...args)}));
vi.mock('../../../questionPool.js',()=>({releaseUnansweredQuestions:vi.fn()}));
import {finalizeExamSession} from './finalize.js';
beforeEach(()=>{
 state.remove.mockReset();state.record.mockReset();
 state.session={sessionId:'s',blockId:'b',status:'in_progress',questions:[{questionId:'bad',lectureId:'l',correct:null,sourceKeyReviewStatus:'key-text-conflict'}],answers:[{questionId:'bad',value:'B'}],sideEffectsCompleted:{statsRecordedQuestionIds:[],weakConceptsRecorded:false}};
 state.weak={b:[{id:'exam:b:l',masteryLevel:'struggling'},{id:'manual',concept:'Keep my notes'}]};
});
it('retracts excluded checkpoint evidence and retires only the derived stale report',async()=>{
 expect(await finalizeExamSession(null,'s')).toEqual({ok:true});
 expect(state.remove).toHaveBeenCalledWith(null,[],{removeEventIds:['exam:s:bad']});
 expect(state.record).not.toHaveBeenCalled();
 expect(state.session.answers).toEqual([{questionId:'bad',value:'B'}]);
 expect(state.session.status).toBe('submitted');
 expect(state.weak.b).toEqual([{id:'manual',concept:'Keep my notes'}]);
});
it('stays resumable if excluding prior evidence cannot be saved',async()=>{
 state.remove.mockRejectedValueOnce(new Error('Offline'));
 expect(await finalizeExamSession(null,'s')).toMatchObject({ok:false,resumable:true,error:'Offline'});
 expect(state.session.status).toBe('finalizing');
 expect(state.weak.b).toHaveLength(2);
 expect(await finalizeExamSession(null,'s')).toEqual({ok:true});
});
