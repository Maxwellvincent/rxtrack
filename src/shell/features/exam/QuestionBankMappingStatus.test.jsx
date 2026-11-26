import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi} from 'vitest';
import {installDomStorage} from '../../../stores/testEnv.js';
const relink=vi.hoisted(()=>vi.fn(async()=>[{status:'complete'}]));
vi.mock('../../logic/relinkQuestionBanks.js',()=>({relinkAllQuestionBanks:relink}));
vi.mock('../../hooks/useStoreResource.js',()=>({useStoreResource:()=>({data:{m:{filename:'Week12',blockId:'b',mappingProgress:{status:'paused',error:'ollama-cloud HTTP 402',evaluated:8,linked:6,currentQuestion:'q9'}},done:{filename:'Complete',blockId:'b',mappingProgress:{status:'complete',evaluated:30,linked:0}}},loading:false,error:null})}));
import {QuestionBankMappingStatus} from './QuestionBankMappingStatus.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('shows the saved cause and resumes the existing bank without reimporting',async()=>{
 installDomStorage();const host=document.createElement('div');const root=createRoot(host);
 act(()=>root.render(<QuestionBankMappingStatus userId="u" blockId="b" filename="Week12" lectures={[]} objectives={[]}/>));
 expect(host.textContent).toContain('Reason: ollama-cloud HTTP 402');expect(host.textContent).toContain('q9');
 await act(async()=>host.querySelector('button').click());
 expect(relink).toHaveBeenCalledWith(expect.objectContaining({filenames:['Week12'],userId:'u'}));act(()=>root.unmount());
});
it('makes completed automatic mapping clear and hides unsupported candidates',()=>{
 installDomStorage();const host=document.createElement('div');const root=createRoot(host);
 act(()=>root.render(<QuestionBankMappingStatus userId="u" blockId="b" filename="Complete" lectures={[]} objectives={[]}/>));
 expect(host.textContent).toContain('Automatic curriculum links');expect(host.textContent).toContain('does not mean the questions are unrelated');expect(host.querySelector('button').textContent).toBe('Recheck unresolved links');act(()=>root.unmount());
});
