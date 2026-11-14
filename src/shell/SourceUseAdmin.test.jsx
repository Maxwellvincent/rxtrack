// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({data:{sources:{}},loading:false,error:null}));
vi.mock('./hooks/useStoreResource.js',()=>({useStoreResource:()=>state}));
vi.mock('../stores/sourceUse.js',()=>({reserve:vi.fn(),setFactual:vi.fn()}));
import {reserve,setFactual} from '../stores/sourceUse.js';
import {SourceUseAdmin} from './SourceUseAdmin.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('keeps administration collapsed and confirms reservations only after save succeeds',async()=>{
 const host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<SourceUseAdmin userId="u" banks={{'Homework.pdf':[]}}/>));
 expect(host.querySelector('details').open).toBe(false);
 state.loading=true;act(()=>root.render(<SourceUseAdmin userId="u" banks={{'Homework.pdf':[]}}/>));
 expect([...host.querySelectorAll('button')].every(button=>button.disabled)).toBe(true);
 state.loading=false;reserve.mockRejectedValueOnce(new Error('offline'));
 act(()=>root.render(<SourceUseAdmin userId="u" banks={{'Homework.pdf':[]}}/>));
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Reserve source').click());
 expect(host.textContent).toContain('Reservation was not confirmed: offline');
 expect(host.textContent).not.toContain('Evaluation reservation saved.');
 reserve.mockResolvedValueOnce({});await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Reserve source').click());
 expect(reserve).toHaveBeenLastCalledWith('u','Homework.pdf',[],true);
 expect(host.textContent).toContain('Evaluation reservation saved.');
 setFactual.mockResolvedValueOnce({});await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Mark not factual').click());
 expect(setFactual).toHaveBeenCalledWith('u','Homework.pdf',false);
 expect(host.textContent).toContain('marked not factual');
 act(()=>root.unmount());
});
