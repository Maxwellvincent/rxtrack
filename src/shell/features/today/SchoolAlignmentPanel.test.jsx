import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach,describe,it,expect,vi } from 'vitest';
import { installDomStorage } from '../../../stores/testEnv.js';
const state=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('../../hooks/useQuestionBanks.js',()=>({useQuestionBanks:()=>({data:{'ER.pdf':[{id:'q',stem:'Which?',choices:{A:'a'},schoolObjectiveCode:'SOM.ER.1',sourceFile:'ER.pdf'}]}})}));
vi.mock('../../hooks/useQuestionBankMeta.js',()=>({useQuestionBankMeta:()=>({data:{b:{filename:'ER.pdf',blockId:'er'}}})}));
vi.mock('../../hooks/useObjectives.js',()=>({useObjectives:()=>({data:{er:[{id:'o',code:'SOM.ER.1',text:'Estrogen synthesis'}]}})}));
vi.mock('../../hooks/useStoreResource.js',()=>({useStoreResource:()=>({data:{},mutate:state.save})}));
import { SchoolAlignmentPanel } from './SchoolAlignmentPanel.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{installDomStorage();state.save.mockReset();});
describe('school alignment panel',()=>{
 it('renders traceable coverage and an honest comparison label, collapsed by default',()=>{
  const host=document.createElement('div'),root=createRoot(host);
  act(()=>root.render(<SchoolAlignmentPanel blockId="er" userId="u" />));
  expect(host.querySelector('details').open).toBe(false);
  expect(host.textContent).toContain('1 of 1 objectives');
  expect(host.textContent).toContain('SOM.ER.1');
  expect(host.textContent).toContain('No validated exam-score prediction');
  expect(host.querySelectorAll('input')).toHaveLength(3);
  act(()=>root.unmount());
 });
});
