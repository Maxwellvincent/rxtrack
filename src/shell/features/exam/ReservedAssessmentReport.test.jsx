import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import {installDomStorage} from '../../../stores/testEnv.js';
import {ReservedAssessmentReport} from './ReservedAssessmentReport.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('shows review priorities and exposure limits only after assessment submission',()=>{
 installDomStorage();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const session={purpose:'reserved-assessment',status:'in_progress',questions:[{questionId:'q1',lectureId:'l',objectiveIds:['o'],correct:'A'},{questionId:'q2',correct:'B'}],answers:[{questionId:'q1',value:'A'}],assessment:{knownPriorExposure:1,unknownPriorExposure:1}};
 act(()=>root.render(<ReservedAssessmentReport session={session}/>));expect(host.textContent).toBe('');
 act(()=>root.render(<ReservedAssessmentReport session={{...session,status:'submitted'}} lectureLabelsByLectureId={{l:'Motor System'}} objectivesById={{o:{text:'Explain the motor pathway'}}}/>));
 expect(host.textContent).toContain('50%');expect(host.textContent).toContain('Motor System · 100%');expect(host.textContent).toContain('No confirmed link · 0%');expect(host.textContent).toContain('Explain the motor pathway');expect(host.querySelector('details').open).toBe(false);
 expect(host.textContent).toContain('not a predicted school score');act(()=>root.unmount());
});
