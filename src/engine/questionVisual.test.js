import {it,expect} from 'vitest';
import {questionReferencesVisual,missingRequiredVisual} from './questionVisual.js';
it('requires an actual exhibit for marked MRI sections but allows self-contained imaging findings',()=>{
 for(const stem of ['Which structure is marked on the MRI below?', 'A lesion in the area marked on the MRI section will cause which deficit?', 'Which area on the CT above explains these symptoms?']) {
  expect(questionReferencesVisual(stem)).toBe(true);expect(missingRequiredVisual({stem})).toBe(true);
  expect(missingRequiredVisual({stem,sourceImageUrl:'saved.jpg'})).toBe(false);
 }
 expect(questionReferencesVisual('MRI shows a small infarct in the left pons. Which deficit is expected?')).toBe(false);
});
