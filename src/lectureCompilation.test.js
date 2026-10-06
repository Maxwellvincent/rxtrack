import { sourceLectureClue } from './shell/features/exam/questionBankLinks.js';
import { describe, it, expect } from 'vitest';
import { parseNumberedQuestionBankText, mergePdfQuestionCandidates, expectedQuestionCountFromAnswerKey } from './examParser.js';
const one = (stem, key) => `1. ${stem}\nA. Alpha\nB. Beta\n${key ? `Answer: ${key}. ${key === 'A' ? 'Alpha' : 'Beta'}\nThis is the source explanation.` : ''}`;
const source = `Questions Only\nNB 01 – First lecture\n${one('Which embryonic structure induces the overlying tissue?')}\n[PAGE_BREAK:2]\nNB 02 – Second lecture\n${one('Which named structure carries signals between hemispheres?')}\nQuestions with Answers and Explanations\nNB 01 – First lecture\n${one('Which embryonic structure induces the overlying tissue?', 'A')}\nNB 02 – Second lecture\n${one('Which named structure carries signals between hemispheres?', 'B')}`;
describe('lecture compilation imports', () => {
 it('preserves restarted numbers and matches keys only inside the lecture', () => {
 const q=parseNumberedQuestionBankText(source);
 expect(q.map(x=>[x.id,x.sourceQuestionNumber,x.correct,x.sourcePage])).toEqual([['nb01-q1',1,'A',1],['nb02-q1',1,'B',2]]);
 expect(sourceLectureClue(q[1])).toMatchObject({number:2,title:'Second lecture'});
 expect(q[0].choices.B).toBe('Beta');
 expect(q[0].explanation).toBe('This is the source explanation.');
 expect(mergePdfQuestionCandidates([q])[1].id).toBe('nb02-q1');
 });
 it('rejects a mismatched repeated stem instead of assigning its key', () => {
 expect(()=>parseNumberedQuestionBankText(source.replace("Which embryonic structure induces the overlying tissue?\nA. Alpha\nB. Beta\nAnswer", "Which unrelated finding explains a completely different disease?\nA. Alpha\nB. Beta\nAnswer"))).toThrow('Source/key stem mismatch');
 });
 it('rejects a lost question boundary instead of silently importing a partial section', () => {
 expect(()=>parseNumberedQuestionBankText(source.replace('1. Which embryonic structure', 'Which embryonic structure'))).toThrow('Source/key question count mismatch');
 });
 it('does not borrow the next lecture key when a source key is absent', () => {
 const q=parseNumberedQuestionBankText(source.replace('Answer: A. Alpha','No answer given'));
 expect(q[0].correct).toBeNull();expect(q[1].correct).toBe('B');
 expect(expectedQuestionCountFromAnswerKey(source.replace('Answer: A. Alpha','No answer given'))).toBe(2);
 });
});
