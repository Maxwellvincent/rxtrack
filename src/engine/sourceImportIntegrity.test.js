import {it,expect} from 'vitest';
import {parseNumberedQuestionBankText} from '../examParser.js';
import {questionReferencesVisual} from './questionVisual.js';
it('keeps original I and J options separate',()=>{
 const q=parseNumberedQuestionBankText('1. Which of the following structures is most likely involved in this patient?\n'+ 'ABCDEFGHIJ'.split('').map(l=>`${l}. Structure ${l}`).join('\n')+'\nAnswer Key: 1 J','test',{singleSet:true,allowSingle:true})[0];
 expect(Object.keys(q.choices)).toHaveLength(10);expect(q.choices.H).toBe('Structure H');expect(q.correct).toBe('J');
});
it('holds a printed answer-letter/text conflict rather than grading against the letter',()=>{
 const section='NB 28 – Sensation\n1. Which of the following sensations is most likely preserved in this patient?\nA. Left stereognosis\nB. Right stereognosis\n';
 const other='NB 31 – Motor\n1. Which of the following is the most likely finding in this patient?\nA. Weakness\nB. Normal strength\n';
 const text=section+other+'Questions with Answers and Explanations\n'+section+'Answer: A. Right stereognosis\nThis is the supplied explanation.\n'+other+'Answer: A. Weakness\nExplanation follows.\n';
 const q=parseNumberedQuestionBankText(text)[0];
 expect(q.correct).toBeNull();expect(q.sourceKeyCandidate).toBe('A');expect(q.sourceKeyTextCandidate).toBe('B');expect(q.sourceKeyReviewStatus).toBe('key-text-conflict');
});
it('recognizes the missing exhibit wording from the reported questions',()=>{
 for(const stem of ['Based on the picture below, which labeled site applies?','The black area in the schematic below indicates damage.','The drawing of a transverse section of the medulla below shows a lesion.']) expect(questionReferencesVisual(stem)).toBe(true);
});
it('marks a drawing-dependent text-option question as requiring a source image',()=>{
 const source='1. Which loss is caused by the lesion marked D in the drawing of the medulla below?\nA. Left hand\nB. Right hand\nAnswer Key: 1 A';
 expect(parseNumberedQuestionBankText(source,'test',{singleSet:true,allowSingle:true})[0].hasImage).toBe(true);
});
