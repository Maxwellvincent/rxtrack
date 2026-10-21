// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({batch:vi.fn(async()=>{}),list:vi.fn(async()=>[])}));
vi.mock('../../hooks/useStoreResource.js',()=>({useStoreResource:()=>({loading:false,error:null})}));
vi.mock('../../../stores/calibrationByBlock.js',()=>({readBlock:()=>[{questionKey:'q',objectiveIds:['o'],correct:true,ts:10}]}));
vi.mock('../../../stores/learnerEvidence.js',()=>({read:()=>({}),questionEvidenceKey:x=>x,recordEvidenceBatchAwait:(...args)=>mocks.batch(...args)}));
vi.mock('../../../stores/questionRatings.js',()=>({isExcluded:()=>false}));
vi.mock('../../../supabase.js',()=>({listExamSessions:(...args)=>mocks.list(...args)}));
import {AnswerHistoryAudit} from './AnswerHistoryAudit.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('audits the selected block, awaits persistence, and reports recovered answers',async()=>{
 const host=document.createElement('div'),root=createRoot(host);
 await act(async()=>root.render(<AnswerHistoryAudit userId="u" blockId="NB" objectives={[{id:'o',linkedLecId:'l',blockId:'NB'}]} />));
 expect(mocks.list).toHaveBeenCalledWith('u','NB');expect(mocks.batch).toHaveBeenCalledOnce();
 expect(host.textContent).toContain('checked');expect(host.textContent).toContain('1 recovered');act(()=>root.unmount());
});
it('keeps failed writes visible without claiming completion',async()=>{
 mocks.batch.mockRejectedValueOnce(new Error('offline'));
 const host=document.createElement('div'),root=createRoot(host);
 await act(async()=>root.render(<AnswerHistoryAudit userId="u" blockId="NB" objectives={[{id:'o',linkedLecId:'l'}]} />));
 expect(host.textContent).toContain('needs attention');expect(host.querySelector('[role="alert"]').textContent).toContain('offline');
 expect(host.textContent).not.toContain('1 recovered');act(()=>root.unmount());
});
