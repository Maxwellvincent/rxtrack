import {it,expect} from 'vitest';
import {parseExamPDF,mergePdfQuestionCandidates,parseLectureCompilationText} from './examParser.js';
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

it('preserves similar numbered source items through extraction merge and completeness guard',async()=>{
 const q='1. A patient has a sensory deficit in the right arm. Which finding is expected?\nA. One\nB. Two\nC. Three\nD. Four';
 const heads=['NB 27 – CNS','NB 28, 29, and 30 – Sensation','NB 31 & 32 – Motor'];
 const text=heads.map(h=>h+'\n'+q).join('\n')+'\nQuestions with Answers and Explanations\n'+heads.map((h,i)=>h+'\n'+(i===1?q.replace('right arm','left arm'):q)+'\nAnswer Key: A. One\nRationale.').join('\n');
 const parsed=parseLectureCompilationText(text);
 expect(mergePdfQuestionCandidates([parsed,parsed])).toHaveLength(3);
 const imported=await parseExamPDF({name:'lecture-compilation.txt',text:async()=>text},null,{requireSourceKeys:true});
 expect(imported.questions).toHaveLength(3);
 expect(imported.questions[1]).toMatchObject({correct:null,sourceKeyCandidate:'A'});
 expect(imported.sourceIssues).toHaveLength(1);
});
it('resolves answer text against original choices rather than relabeled keyed options',()=>{
 const q='1. Which labeled position is affected?\nA. Position (A)\nB. Position (B)\nC. Position (D)\nD. Position (E)';
 const text='NB 28, 29, and 30 – Sensation\n'+q+'\nNB 31 & 32 – Motor\n'+q+'\nQuestions with Answers and Explanations\nNB 28, 29, and 30 – Sensation\n'+q.replace('A. Position','H. Position').replace('B. Position','I. Position')+'\nAnswer Key: Position (B)\nRationale.\nNB 31 & 32 – Motor\n'+q+'\nAnswer: A\nRationale.';
 expect(parseLectureCompilationText(text)[0].correct).toBe('B');
});
