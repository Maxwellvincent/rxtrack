import {it,expect} from 'vitest';
import {parseLectureCompilationText} from '../examParser.js';
it('retains a bitmap-only choice grid for source review without inventing options or blocking the bank',()=>{
 const text='NB 39 – Retina\n1. Which finding is most likely on funduscopic examination?\n\fNB 40 – Pathways\n1. Which of these sensory pathways is damaged in this patient?\nA. First\nB. Second\nQuestions with Answers and Explanations\nNB 39 – Retina\n1. Which finding is most likely on funduscopic examination?\nAnswer: C. Figure C\nNB 40 – Pathways\n1. Which of these sensory pathways is damaged in this patient?\nA. First\nB. Second\nAnswer: B. Second';
 const q=parseLectureCompilationText(text);
 expect(q).toHaveLength(2);expect(q[0]).toMatchObject({choices:{},correct:null,hasImage:true,sourceKeyCandidate:'C',sourceKeyReviewStatus:'visual-choice-labels-missing'});
 expect(q[1].correct).toBe('B');
});
it('does not mistake PDF spacing in the patient stem for choice A and reads spaced key punctuation',()=>{
 const item='1. A   31-year-old woman has a sensory deficit. Which pathway is involved?\nA. First pathway\nB. Second pathway';
 const text=`NB 35 – Peripheral nerves\n${item}\nNB 36 – Motor system\n${item}\nQuestions with Answers and Explanations\nNB 35 – Peripheral nerves\n${item}\nAnswer : B . Second pathway\nNB 36 – Motor system\n${item}\nAnswer: A. First pathway`;
 const q=parseLectureCompilationText(text);
 expect(q).toHaveLength(2);expect(q.map(q=>q.correct)).toEqual(['B','A']);expect(q[0].stem).toMatch(/^A 31-year-old/);
});
