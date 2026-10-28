import {it,expect} from 'vitest';
import {linkedConceptPlan,linkedConceptInstruction,attributeLinkedConcept} from './linkedConceptCoverage.js';
const atoms=[{term:'Dorsal columns',content:'Carry vibration.',objectiveIds:['a'],importanceTier:'core'},{term:'Medial lemniscus',content:'Crossed sensory fibers.',objectiveIds:['a']},{term:'Spinothalamic tract',content:'Pain pathway.',objectiveIds:['b']}];
it('reserves concept targets across objectives and rotates answered concepts',()=>{
 const objectives=[{id:'a',_targetQuestionCount:1},{id:'b',_targetQuestionCount:1}];
 expect(linkedConceptPlan(atoms,objectives,{},2).map(a=>a.term)).toEqual(['Dorsal columns','Spinothalamic tract']);
 expect(linkedConceptPlan(atoms,objectives,{atoms:{dorsalcolumns:{attempts:1,lastSeen:1}}},2).length).toBe(2);
 const first=linkedConceptPlan(atoms,[{id:'a'}],{},1)[0];
 const next=linkedConceptPlan(atoms,[{id:'a'}],{learningJournal:[{at:2,sourceConceptKeys:[first.coverageKey]}]},1);
 expect(next[0].term).toBe('Medial lemniscus');
});
it('does not attribute distractor-only terms or unrelated objectives',()=>{
 const q={stem:'Which pathway carries pain?',choices:{A:'Spinothalamic tract',B:'Dorsal columns'},correct:'A',explanation:'Pain ascends here.',objectiveIds:['b']};
 const tagged=attributeLinkedConcept(q,atoms.map(a=>({...a,coverageKey:a.term})));
 expect(tagged.sourceConceptKeys).toEqual(['Spinothalamic tract']);
 expect(attributeLinkedConcept({...q,objectiveIds:['other']},atoms)).not.toHaveProperty('sourceConceptKeys');
});
it('does not treat untagged reference facts as required objective targets',()=>{
 expect(linkedConceptPlan([{term:'Extra',content:'Reference only.'}],[{id:'a'}],{},5)).toEqual([]);
 expect(linkedConceptInstruction(atoms)).toContain('term would reveal the answer');
 expect(linkedConceptInstruction(atoms)).toContain('Never omit a clue');
});
it('does not award concept exposure for explanation-only name drops',()=>{
 const q={stem:'Which finding follows?',topic:'Sensory loss',choices:{A:'One',B:'Two'},correct:'A',objectiveIds:['a'],explanation:'Unlike the dorsal columns this is different.'};
 expect(attributeLinkedConcept(q,atoms)).not.toHaveProperty('sourceConceptKeys');
});
