// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({data:{sources:{}},loading:false,error:null}));
vi.mock('./hooks/useStoreResource.js',()=>({useStoreResource:()=>state}));
vi.mock('../stores/sourceUse.js',()=>({reserve:vi.fn()}));
import {reserve} from '../stores/sourceUse.js';
import {SourceUseAdmin} from './SourceUseAdmin.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('keeps administration collapsed and confirms reservations only after save succeeds',async()=>{
 const host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<SourceUseAdmin userId="u" banks={{'Homework.pdf':[]}}/>));
 expect(host.querySelector('details').open).toBe(false);
 state.loading=true;act(()=>root.render(<SourceUseAdmin userId="u" banks={{'Homework.pdf':[]}}/>));
 expect(host.querySelector('button').disabled).toBe(true);
 state.loading=false;reserve.mockRejectedValueOnce(new Error('offline'));
 act(()=>root.render(<SourceUseAdmin userId="u" banks={{'Homework.pdf':[]}}/>));
 await act(async()=>host.querySelector('button').click());
 expect(host.textContent).toContain('Reservation was not confirmed: offline');
 expect(host.textContent).not.toContain('Evaluation reservation saved.');
 reserve.mockResolvedValueOnce({});await act(async()=>host.querySelector('button').click());
 expect(reserve).toHaveBeenLastCalledWith('u','Homework.pdf',[],true);
 expect(host.textContent).toContain('Evaluation reservation saved.');
 act(()=>root.unmount());
});
