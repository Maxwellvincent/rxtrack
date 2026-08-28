import { describe,it,expect } from 'vitest';
import { compareSchoolResults,validateSchoolResult } from './examComparison.js';
const report={id:'r',blockId:'er',name:'Exam',date:'2026-08-27',kind:'exam',percent:74};
const session=(id,extra={})=>({sessionId:id,blockId:'er',format:'exam',status:'submitted',submittedAt:'2026-08-26T12:00:00',questions:[{questionId:'q',stem:id,correct:'A',difficulty:'medium'}],answers:[{questionId:'q',value:'A'}],...extra});
describe('school result comparison',()=>{
 it('pairs only prior-week same-block timed practice and includes skips as incorrect',()=>{
  const s=session('fresh',{answers:[]});
  const result=compareSchoolResults('er',[s,session('other',{blockId:'other'}),session('later',{submittedAt:'2026-08-28T12:00:00'})],[report]);
  expect(result.pairs[0]).toMatchObject({practiceCount:1,practiceAccuracy:0,gap:74});
 });
 it('excludes repeats after untimed exposure, IMCQs and unknown difficulty',()=>{
  const first=session('repeat',{sessionId:'first',format:'practice',submittedAt:'2026-08-25T12:00:00'});
  const imcq=session('imcq',{questions:[{stem:'imcq',difficulty:'medium',sourceKind:'imcq'}]});
  const unknown=session('legacy',{questions:[{stem:'legacy'}]});
  expect(compareSchoolResults('er',[first,session('repeat'),imcq,unknown],[report]).pairs[0].practiceAccuracy).toBeNull();
 });
 it('deduplicates sessions and keeps quiz reports labeled separately',()=>{
  const s=session('fresh');
  expect(compareSchoolResults('er',[s,s],[{...report,kind:'quiz'}]).pairs[0]).toMatchObject({practiceCount:1,kind:'quiz'});
 });
 it('rejects invalid results, allows an actual zero, and never manufactures predictions',()=>{
  expect(validateSchoolResult({...report,percent:0})).toBe(true);
  expect(validateSchoolResult({...report,percent:101})).toBe(false);
  expect(validateSchoolResult({...report,date:'nonsense'})).toBe(false);
  expect(compareSchoolResults('er',[],[report]).pairs[0].gap).toBeNull();
 });
});
