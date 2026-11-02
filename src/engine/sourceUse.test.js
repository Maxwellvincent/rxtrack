import {describe,it,expect} from 'vitest';
import {sourceItemId,reserveSource,recordSourceContext,isEvaluationReserved,sourceExposure,allowedGenerationExamples} from './sourceUse.js';
const q={stem:'Which structure transmits this sensory signal?',choices:{A:'First structure',B:'Second structure'},correct:'A',sourceFile:'Homework.pdf'};
describe('evaluation source boundaries',()=>{
 it('keeps identity across filenames, option relabeling and source-key corrections',()=>{
  expect(sourceItemId(q)).toBe(sourceItemId({...q,sourceFile:'Alias.pdf',choices:{B:'First structure',A:'Second structure'},correct:'B'}));
 });
 it('excludes duplicates under other filenames without deleting the original',()=>{
  const registry=reserveSource({},q.sourceFile,[q],true,1);
  expect(allowedGenerationExamples([q,{...q,sourceFile:'Alias.pdf'}],registry)).toEqual([]);
  expect(q.correct).toBe('A');expect(sourceExposure(q,registry)).toBe('unknown');
 });
 it('reserves future imports by source name',()=>{
  expect(isEvaluationReserved(q,reserveSource({},q.sourceFile,[],true,1))).toBe(true);
 });
 it('records only allowed preparation context and never claims actual model use or unseen status',()=>{
  const reserved=reserveSource({},q.sourceFile,[q],true,1);
  expect(recordSourceContext(reserved,[q],2).allowed).toEqual([]);
  expect(sourceExposure(q,reserved)).toBe('unknown');
  const result=recordSourceContext({},[q],2);
  expect(sourceExposure(q,result.registry)).toBe('preparation-context');
  expect(result.registry.items[sourceItemId(q)]).not.toHaveProperty('stem');
 });
 it('does not reset exposure when reserving or releasing an exposed example',()=>{
  const exposed=recordSourceContext({},[q],1).registry;
  const released=reserveSource(reserveSource(exposed,q.sourceFile,[q],true,2),q.sourceFile,[q],false,3);
  expect(sourceExposure(q,released)).toBe('preparation-context');expect(isEvaluationReserved(q,released)).toBe(false);
 });
 it('keeps duplicate reservations until every reserving source releases them',()=>{
  let registry=reserveSource({},'Homework.pdf',[q],true,1);
  registry=reserveSource(registry,'Alias.pdf',[q],true,2);
  registry=reserveSource(registry,'Homework.pdf',[q],false,3);
  expect(isEvaluationReserved(q,registry)).toBe(true);
 });
 it('stops rather than silently pruning a full registry',()=>{
  expect(()=>recordSourceContext({items:{large:{reserved:true,note:'x'.repeat(860000)}}},[q],1)).toThrow('registry is full');
 });
});
