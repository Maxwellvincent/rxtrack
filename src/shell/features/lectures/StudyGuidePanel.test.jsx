// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {normalizeStudyGuide,mergeStudyGuide} from '../../../engine/studyGuides.js';
const state=vi.hoisted(()=>({catalog:{guides:{}}}));
vi.mock('../../hooks/useStoreResource.js',()=>({useStoreResource:()=>({data:state.catalog,loading:false,error:null})}));
vi.mock('../../../llmBridge.js',()=>({bridgeStudyTables:vi.fn()}));
vi.mock('../../../supabase.js',()=>({uploadQuestionBankSource:vi.fn(),fetchQuestionBankSourceUrl:vi.fn()}));
import {StudyGuidePanel} from './StudyGuidePanel.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('groups learning suggestions by objective and keeps import controls in Sources',()=>{
 const g=normalizeStudyGuide({format:'rxtrack-study-guide',version:1,sourceVersion:'v',pageCount:1,rows:[{page:1,table:1,row:1,section:'NB 37 Cerebellum',heading:'Coordination',label:'Vermis',headers:['Zone','Finding'],cells:['Vermis','Cerebellar gait coordination']} ]});
 state.catalog=mergeStudyGuide({},g);const host=document.createElement('div'),root=createRoot(host);
 const props={blockId:'b',lecture:{title:'NB 37 Cerebellum'},objectives:[{id:'o',objective:'Explain cerebellar gait coordination'}]};
 act(()=>root.render(<StudyGuidePanel {...props} mode="learn"/>));
 expect(host.textContent).toContain('Explain cerebellar gait coordination');expect(host.textContent).toContain('Vermis');expect(host.querySelector('input[type=file]')).toBeNull();expect(host.textContent).toContain('does not count');
 act(()=>root.render(<StudyGuidePanel {...props}/>));expect(host.querySelector('input[type=file]')).not.toBeNull();
 act(()=>root.unmount());
});
