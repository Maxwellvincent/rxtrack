import { it, expect, vi } from 'vitest';
const state=vi.hoisted(()=>({sessions:[],weak:{b:[{id:'manual',concept:'Keep manual note'},{id:'exam:b:l',missCount:2}]}}));
vi.mock('../supabase.js',()=>({listExamSessions:vi.fn(async()=>state.sessions)}));
vi.mock('./weakConcepts.js',()=>({read:()=>state.weak,writeAwait:vi.fn(async(_u,next)=>{state.weak=next;})}));
import { reconcileQuestionQuality } from './questionQualityReconciliation.js';
it('rebuilds only the affected exam weak-area row and can restore it from original answers', async()=>{
 const questions=[1,2,3].map(i=>({questionId:`q${i}`,lectureId:'l',blockId:'b',correct:'A'}));
 state.sessions=[{sessionId:'s',blockId:'b',submittedAt:1,questions,answers:[{questionId:'q1',value:'A'}]}];
 await reconcileQuestionQuality('u',{lectureId:'l',blockId:'b'});
 expect(state.weak.b.map(row=>row.id)).toEqual(['manual']);
 state.sessions[0].answers.push({questionId:'q2',value:'B'},{questionId:'q3',value:'B'});
 await reconcileQuestionQuality('u',{lectureId:'l',blockId:'b'});
 expect(state.weak.b.find(row=>row.id==='exam:b:l')).toMatchObject({missCount:2,totalAttempts:3,masteryLevel:'struggling'});
});
