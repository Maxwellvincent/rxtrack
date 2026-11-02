import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi} from 'vitest';import {installDomStorage} from '../../stores/testEnv.js';import {notifyExamSessionChange} from '../../examSessionChanges.js';
const list=vi.hoisted(()=>vi.fn(async()=>[]));
vi.mock('../../supabase.js',()=>({listExamSessions:(...args)=>list(...args)}));
vi.mock('./useStudyAnswerHistory.js',()=>({useStudyAnswerHistory:()=>({studyAnswers:[],historicalStudy:{},loading:false})}));
vi.mock('./useStoreResource.js',()=>({useStoreResource:()=>({data:{},loading:false})}));
vi.mock('../../stores/questionRatings.js',()=>({read:()=>({ratings:{}}),subscribe:()=>()=>{}}));
import {useQuestionPractice} from './useQuestionPractice.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('refreshes saved history immediately for this account and block, without reacting to unrelated publications',async()=>{
 installDomStorage();list.mockClear();let api;function Probe(){api=useQuestionPractice('u','nb2');return null;}const root=createRoot(document.createElement('div'));await act(async()=>root.render(<Probe/>));expect(list).toHaveBeenCalledTimes(1);
 await act(async()=>notifyExamSessionChange({userId:'other',blockId:'nb2'}));expect(list).toHaveBeenCalledTimes(1);
 await act(async()=>notifyExamSessionChange({userId:'u',blockId:'nb1'}));expect(list).toHaveBeenCalledTimes(1);
 await act(async()=>notifyExamSessionChange({userId:'u',blockId:'nb2'}));expect(list).toHaveBeenCalledTimes(2);expect(api.loading).toBe(false);await act(async()=>root.unmount());
});
