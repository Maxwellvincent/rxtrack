import { it, expect } from 'vitest';
import { markBoldChoiceItems, parsePairedSourceDocuments } from './pairedSourceParser.js';
import { pairQuestionBankFiles } from './questionBankIngest.js';
it('pairs both supplied filename conventions despite parentheses and a typo',()=>{
 const files=['SNL DES SGU BPM II NB.pdf','SNL DES SGU BPM II NB (Answers).pdf','Week 10 Answers.pdf','Week 10 Practice Quesxtions.pdf'].map(name=>({name}));
 expect(pairQuestionBankFiles(files)).toHaveLength(2);
});
it('preserves sparse source numbers and disambiguates identical numbers by lecture section',()=>{
 const q='NB 13 Facial nerve\n21. Which nerve?\nA. Alpha\nB.Beta\nNB 19 Eye\n21. Which muscle?\nA. First\nB.Second';
 const a='NB 13 Facial nerve\n21. B. Source rationale.\nNB 19 Eye\n21. A. Different rationale.';
 const result=parsePairedSourceDocuments(q,a);
 expect(result.map(x=>[x.sourceSection,x.sourceQuestionNumber,x.correct])).toEqual([['NB 13',21,'B'],['NB 19',21,'A']]);
});
it('uses font evidence only on option labels, including a label on its own line',()=>{
 const items=[{str:'Question heading',fontName:'bold'},{str:'(C)',fontName:'bold'},{str:'(B) Something',fontName:'normal'}];
 expect(markBoldChoiceItems(items,f=>f==='bold'?'Times-Bold':'Times').map(x=>x.str)).toEqual(['Question heading','✓ (C)','(B) Something']);
});
it('matches duplicate printed numbers by exact normalized stem, never by position',()=>{
 const q='12. First stem?\n(A) One\n(B) Two\n12. Second stem?\n(A) Three\n(B) Four';
 const a='12. Second stem?\n✓ (A) Three\n(B) Four\n12. First stem?\n(A) One\n✓ (B) Two';
 expect(parsePairedSourceDocuments(q,a).map(x=>x.correct)).toEqual(['B','A']);
});
it('reports incomplete originals and rejects missing or ambiguous keys',()=>{
 const q='1. Which option?\nA. First\nB. Second\n2. Truncated source.';
 const result=parsePairedSourceDocuments(q,'1. B. Original rationale.');
 expect(result).toHaveLength(1);expect(result.sourceIssues[0]).toContain('Q2');
 expect(()=>parsePairedSourceDocuments(q,'1. Which option?\nA. First\nB. Second')).toThrow('source-marked');
});
it('does not mistake a split temperature for a numbered question',()=>{
 const q='20. A patient has temperature\n37. 5°C and pain. Which option?\nA. First\nB. Second';
 expect(parsePairedSourceDocuments(q,'20. A. Rationale.')[0].sourceQuestionNumber).toBe(20);
});
