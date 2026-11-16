// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({data:{snapshots:[],audits:[]},freeze:vi.fn(async()=>{})}));
vi.mock('../../hooks/useStoreResource.js',()=>({useStoreResource:()=>({data:state.data,loading:false,error:null})}));
vi.mock('../../../stores/readinessValidation.js',()=>({freezeSnapshot:(...args)=>state.freeze(...args),saveActual:vi.fn(),saveAudit:vi.fn()}));
import {ReadinessValidation} from './ReadinessValidation.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('withholds unsupported numeric predictions and offers a durable pre-test snapshot',async()=>{
 const host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<ReadinessValidation userId="u" blockId="b" lectures={[{id:'l',blockId:'b',lectureTitle:'Lecture'}]}/>));
 expect(host.textContent).toContain('provisional estimate: Not estimated');
 expect(host.textContent).toContain('not a probability of passing');
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Save pre-test snapshot');
 await act(async()=>{button.click();});
 expect(state.freeze).toHaveBeenCalledWith('u',expect.objectContaining({goal:80,estimatePercent:null,lectureIds:['l']}));
 expect(host.textContent).toContain('Pre-test snapshot saved and locked');
 act(()=>root.unmount());
});
it('shows the actual school outcome against the unchanged saved estimate',()=>{
 state.data={audits:[],snapshots:[{id:'s',blockId:'b',name:'School test',createdAt:100,testAt:200,goal:80,total:30,estimatePercent:85,actual:{correct:40,total:50,percent:80,goalMet:true,errorPoints:-5}}]};
 const host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<ReadinessValidation userId="u" blockId="b"/>));
 expect(host.textContent).toContain('Pre-test estimate: 85.0%');
 expect(host.textContent).toContain('80% goal met');
 expect(host.textContent).toContain('Actual minus estimate: -5.0 percentage points');
 expect(host.textContent).toContain('average absolute estimate error: 5.0');
 act(()=>root.unmount());
});
