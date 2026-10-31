import {it,expect} from 'vitest';
import {schoolExemplarIssues,requiresSchoolFigure} from './schoolSourceIntegrity.js';
import {selectStyleExemplars} from './mcq.js';
import {buildStyleProfile} from './styleProfile.js';
import {alignSchoolQuestions} from './schoolAlignment.js';
const base={choices:{A:'Alpha',B:'Beta'},correct:'A',sourceFile:'IMCQ.pdf'};
it('keeps a valid concise question while withholding actual imported continuation and missing context',()=>{
 const good={...base,stem:'Which structure supplies this muscle?'};
 const fragment={...base,stem:'that is being ablated, which of the following is the embryological origin of this area?'};
 const dependent={...base,stem:'The autopsy specimen described in Question 31 is examined. Identify the apical membrane feature.'};
 expect(schoolExemplarIssues(fragment)).toContain('stem_continuation');
 expect(schoolExemplarIssues(dependent)).toContain('missing_prior_question_context');
 expect(schoolExemplarIssues(good)).toEqual([]);
 expect(selectStyleExemplars([fragment,dependent,good],10)).toEqual([good]);
 expect(buildStyleProfile([fragment,dependent,good]).sampleSize).toBe(1);
 expect(alignSchoolQuestions([fragment,dependent],[],[])).toEqual([]);
});
it('does not relabel original keys or mutate imported questions',()=>{
 const held={...base,stem:'Which mechanism explains this finding?',sourceKeyReviewStatus:'stem-mismatch'};
 const before=JSON.stringify(held);expect(schoolExemplarIssues(held)).toContain('unverified_source_key');expect(JSON.stringify(held)).toBe(before);
});

it('detects missing visual flags without confusing described imaging findings with required figures',()=>{
 const stems=['An ECG in lead II is shown below. What is the heart rate?', 'The curves are shown in the figure. Which point applies?', 'Cells indicated by the letter A (see attached figure) are activated.'];
 for(const stem of stems){
  const q={...base,stem};
  expect(requiresSchoolFigure(q)).toBe(true);
  expect(selectStyleExemplars([q],1)).toEqual([]);
 }
 expect(requiresSchoolFigure({...base,stem:'MRI shows a mass in the sella turcica. Which mechanism explains hyperglycemia?'})).toBe(false);
});
