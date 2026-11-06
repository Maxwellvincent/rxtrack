import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseClassQuestionSlides } from './pptxQuestions.js';
const parser = new JSDOM().window.DOMParser;
globalThis.DOMParser = parser;
const p = (t, numbered = false, highlighted = false) => `<a:p>${numbered ? '<a:pPr><a:buAutoNum type="alphaUcPeriod"/></a:pPr>' : ''}<a:r><a:rPr>${highlighted ? '<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>' : ''}</a:rPr><a:t>${t}</a:t></a:r></a:p>`;
const slide = (page, { key = -1, labels = 8, table = false } = {}) => ({ page, xml: `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp>${p('Question 1 - Lecture 27')}${p('Which labeled structure is shown?')}${table ? '' : Array.from({length:labels},(_,i)=>p(`Structure ${i}`,true,i===key)).join('')}</p:sp>${table ? '<a:tbl>'+['A','B','C','D'].map(l=>'<a:tr><a:tc>'+p(l)+'</a:tc><a:tc>'+p('Yes')+'</a:tc><a:tc>'+p('No')+'</a:tc></a:tr>').join('')+'</a:tbl>' : '<p:pic/>'}</p:sld>` });
describe('native class-question decks', () => {
 it('pairs originals and answer slides, retaining every option and the original stem', () => {
  const [q] = parseClassQuestionSlides([slide(4,{labels:10}),slide(5,{labels:10,key:7})]);
  expect(Object.keys(q.choices)).toEqual('ABCDEFGHIJ'.split(''));
  expect(q).toMatchObject({id:'class-nb27-q1',correct:'H',sourcePage:4,sourceAnswerPage:5,hasImage:true});
 });
 it('keeps unkeyed and multiply highlighted items unscored',()=>{
  expect(parseClassQuestionSlides([slide(4)])[0].correct).toBeNull();
 });
 it('preserves table options with their source visual',()=>{
  const [q]=parseClassQuestionSlides([slide(4,{table:true})]);
  expect(q.choices).toEqual({A:'Yes | No',B:'Yes | No',C:'Yes | No',D:'Yes | No'});
  expect(q.hasImage).toBe(true);expect(q.correct).toBeNull();
 });
});
