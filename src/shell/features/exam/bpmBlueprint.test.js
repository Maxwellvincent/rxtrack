import { expect, it } from 'vitest';
import { subjectTargets, objectiveSubject, allocateBlueprint, slotKey, blueprintInventory } from './bpmBlueprint.js';
it('uses Test 3 weights and exact whole-question totals for every count',()=>{
 expect(subjectTargets(3,40).map(r=>[r.subject,r.count])).toEqual([['anatomy',20],['neuroscience',17],['histology',3]]);
 for(let exam=1;exam<=5;exam++)for(let count=1;count<=100;count++)expect(subjectTargets(exam,count).reduce((n,r)=>n+r.count,0)).toBe(count);
});
it('reads discipline codes before topic names and keeps unknowns unclassified',()=>{
 expect(objectiveSubject({code:'SOM.MKII.BPM2.1.NB.1.ANAT.0142',objective:'Cranial nerve function'})).toBe('anatomy');
 expect(objectiveSubject({code:'SOM.MKII.BPM2.1.NB.1.NSCI.001'})).toBe('neuroscience');
 expect(objectiveSubject({discipline:'HCB'})).toBe('histology');
 expect(objectiveSubject({objective:'Neuron anatomy'})).toBe(null);
});
it('splits mixed lectures by objective discipline without replacing real lecture identity',()=>{
 const eligibleLectures=[{lectureId:'mixed',objectiveCount:3}],objectivesByLecture={mixed:[{id:'a',discipline:'ANAT'},{id:'n',discipline:'NSCI'},{id:'h',discipline:'HCB'}]};
 const allocation=allocateBlueprint({exam:3,requestedCount:40,eligibleLectures,objectivesByLecture,sessionId:'test'});
 expect(allocation).toEqual({[slotKey('mixed','anatomy')]:20,[slotKey('mixed','neuroscience')]:17,[slotKey('mixed','histology')]:3});
 expect(blueprintInventory(eligibleLectures,objectivesByLecture).counts).toEqual({anatomy:1,neuroscience:1,histology:1});
});
it('does not silently replace a missing subject quota',()=>{
 expect(()=>allocateBlueprint({exam:3,requestedCount:40,eligibleLectures:[{lectureId:'a'}],objectivesByLecture:{a:[{discipline:'ANAT'}]}})).toThrow(/Neuroscience.*Histology/);
});
