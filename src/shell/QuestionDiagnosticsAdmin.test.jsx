// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({allowed:true,loading:false,error:null}));
vi.mock('../diagnosticsAccess.js',()=>({canViewQuestionDiagnostics:()=>state.allowed}));
vi.mock('../questionDiagnostics.js',()=>({readQuestionDiagnostics:()=>null}));
vi.mock('./features/lectures/QuestionPreparationDetails.jsx',()=>({QuestionPreparationDetails:()=>null}));
vi.mock('./ObjectiveIntegrityAdmin.jsx',()=>({ObjectiveIntegrityAdmin:()=>null}));
vi.mock('./hooks/useStoreResource.js',()=>({useStoreResource:()=>({data:{},loading:state.loading,error:state.error})}));
vi.mock('../engine/questionAuditBaseline.js',()=>({buildQuestionAuditBaseline:vi.fn(()=>({version:1})),downloadQuestionAuditBaseline:vi.fn()}));
import {QuestionDiagnosticsAdmin} from './QuestionDiagnosticsAdmin.jsx';
import {downloadQuestionAuditBaseline} from '../engine/questionAuditBaseline.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('exports only through the authorized local review action after stores finish loading',()=>{
 const host=document.createElement('div'),root=createRoot(host);state.allowed=false;
 act(()=>root.render(<QuestionDiagnosticsAdmin userId="u"/>));expect(host.textContent).toBe('');
 state.allowed=true;state.loading=true;act(()=>root.render(<QuestionDiagnosticsAdmin userId="u"/>));expect([...host.querySelectorAll('button')].find(b=>b.textContent.includes('Loading')).disabled).toBe(true);
 state.loading=false;state.error=new Error('offline');act(()=>root.render(<QuestionDiagnosticsAdmin userId="u"/>));expect(host.querySelector('[role="alert"]')).not.toBeNull();expect([...host.querySelectorAll('button')].find(b=>b.textContent.includes('Download')).disabled).toBe(true);
 state.error=null;act(()=>root.render(<QuestionDiagnosticsAdmin userId="u"/>));
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Download')).click());expect(downloadQuestionAuditBaseline).toHaveBeenCalledWith({version:1});act(()=>root.unmount());
});
