import {it,expect} from 'vitest';
import {parseLectureCompilationText} from './examParser.js';
it('keeps combined lecture sections and local question numbering separate',()=>{
 const sections=['NB 27 – CNS','NB 28, 29, and 30 – Sensation','NB 31 & 32 – Motor'];
 const q='1. Which finding is expected?\nA. One\nB. Two\nC. Three\nD. Four';
 const text=sections.map(h=>h+'\n'+q).join('\n')+'\nQuestions with Answers and Explanations\n'+sections.map(h=>h+'\n'+q+'\nAnswer: A.\nExplanation.').join('\n');
 const rows=parseLectureCompilationText(text);
 expect(rows).toHaveLength(3);
 expect(rows[1]).toMatchObject({sourceSection:'NB 28 / NB 29 / NB 30',sourceLectureNumbers:[28,29,30],sourceQuestionNumber:1,correct:'A'});
 expect(rows[2].sourceLectureNumbers).toEqual([31,32]);
});
it('withholds mismatched source keys instead of aborting unrelated questions',()=>{
 const q='1. Which finding is expected?\nA. One\nB. Two\nC. Three\nD. Four';
 const text='NB 28, 29, and 30 – Sensation\n'+q+'\nNB 31 & 32 – Motor\n'+q+'\nQuestions with Answers and Explanations\nNB 28, 29, and 30 – Sensation\n'+q.replace('finding','different finding')+'\nAnswer: B\nRationale.\nNB 31 & 32 – Motor\n'+q+'\nAnswer: A\nRationale.';
 const rows=parseLectureCompilationText(text);
 expect(rows[0]).toMatchObject({correct:null,sourceKeyCandidate:'B',sourceKeyReviewStatus:'stem-mismatch'});
 expect(rows[1].correct).toBe('A');
});
