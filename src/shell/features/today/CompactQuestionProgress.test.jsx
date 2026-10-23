import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {installDomStorage} from '../../../stores/testEnv.js';
vi.mock('../../hooks/useQuestionPractice.js',()=>({useQuestionPractice:()=>({studyAnswers:[{ts:10,concept:'A',correct:true},{ts:20,concept:'B',correct:false}],sessions:[],manualEntries:[{completedAt:30,questionCount:60}],historicalStudy:{answered:61,correct:45},loading:false,error:null})}));
import {CompactQuestionProgress} from './BlockPracticeCard.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('makes the accuracy denominator and unscored outside volume explicit',()=>{
 installDomStorage();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<CompactQuestionProgress userId="u" blockId="b"/>));
 expect(host.textContent).toContain('123completed');expect(host.textContent).toContain('46 correct of 63 scored · 60 without a score.');
 expect(host.textContent).toContain('61 older recorded practice answers');expect(host.textContent).toContain('73.0%');
 act(()=>root.unmount());
});
