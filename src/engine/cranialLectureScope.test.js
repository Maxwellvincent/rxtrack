import { describe, it, expect } from 'vitest';
import { cranialNerveScope, repairCranialLectureLinks } from './cranialLectureScope.js';
import { matchLectureToSection, extractCodeDelimited } from '../ingest/objectives.js';
const lecture={id:'17',blockId:'nb',lectureTitle:'NB 17 Cranial Nerves IX and X'};
const other={id:'13',blockId:'nb',lectureTitle:'NB 13 Cranial Nerves V and VII'};
const incoming=[175,176,177].map(n=>({id:`new-${n}`,code:`SOM.ANAT.0${n}`,linkedLecId:'17',sourceFile:'17',objective:'Describe glossopharyngeal nerve'}));
describe('cranial lecture identity',()=>{
 it('keeps Roman numerals that distinguish lecture titles',()=>{
  expect(cranialNerveScope(other.lectureTitle)).toEqual([5,7]);
  expect(cranialNerveScope(lecture.lectureTitle)).toEqual([9,10]);
  expect(matchLectureToSection({activity:'LEC',title:'Cranial Nerves V and VII'},[lecture,other])).toBe(other);
  expect(matchLectureToSection({activity:'LEC',title:'Cranial Nerves IX and X'},[other,lecture])).toBe(lecture);
  expect(matchLectureToSection({activity:'LEC',title:'Cranial Nerves V and VII'},[lecture])).toBeNull();
 });
 it('repairs wrong links while preserving objective identity, notes, and results',()=>{
  const original=[{id:'old-facial',code:'SOM.ANAT.0169',objective:'Describe the facial nerve',linkedLecId:'17',attempts:9,personalNotes:'keep'}, {...incoming[0],id:'old-175',attempts:4}];
  const result=repairCranialLectureLinks(original,lecture,incoming,[lecture,other]);
  expect(result.find(o=>o.id==='old-facial')).toMatchObject({linkedLecId:'13',attempts:9,personalNotes:'keep'});
  expect(result.find(o=>o.code===incoming[0].code)).toMatchObject({id:'old-175',attempts:4});
  expect(result.filter(o=>o.linkedLecId==='17')).toHaveLength(3);
  expect(repairCranialLectureLinks(result,lecture,incoming,[lecture,other])).toBe(result);
 });
 it('unlinks uncertain matches without deleting evidence and respects manual alignment',()=>{
  const wrong={id:'wrong',objective:'Describe the trigeminal nerve',linkedLecId:'17',attempts:5};
  expect(repairCranialLectureLinks([wrong],lecture,incoming,[])[0]).toMatchObject({id:'wrong',linkedLecId:null,attempts:5});
  expect(repairCranialLectureLinks([{...wrong,manuallyAligned:true}],lecture,incoming,[])[0].linkedLecId).toBe('17');
 });
});

it('detaches absent coded objectives even when their wording is generic',()=>{
 const old={id:'wrong-generic',code:'SOM.ANAT.0155',linkedLecId:'17',objective:'List names of cranial nerves',attempts:2};
 const result=repairCranialLectureLinks([old],lecture,incoming,[lecture,other]);
 expect(result.find(o=>o.id==='wrong-generic')).toMatchObject({linkedLecId:null,attempts:2});
});

it.each([
 ['Cranial Nerves 9 and 10', [9,10]],
 ['Cranial Nerves IX & 10', [9,10]],
 ['CN9/CNX', [9,10]],
 ['CN IX, X', [9,10]],
 ['Cranial nerves 5 and 7', [5,7]],
 ['Cranial nerves IX–XII', [9,10,11,12]],
 ['Cranial nerves 9-12', [9,10,11,12]],
 ['NB 17 Introduction', []],
 ['Cranial nerve 19', []],
])('normalizes scoped nerve numbers: %s', (title, expected)=>{
 expect(cranialNerveScope(title)).toEqual(expected);
});
it('matches Arabic, Roman and abbreviated titles without mixing nerve groups',()=>{
 expect(matchLectureToSection({activity:'LEC',title:'Cranial Nerves 9 and 10'},[other,lecture])).toBe(lecture);
 expect(matchLectureToSection({activity:'LEC',title:'CN IX / X'},[other,lecture])).toBe(lecture);
 const numeric={...lecture,lectureTitle:'Cranial Nerves 9 and 10'};
 expect(matchLectureToSection({activity:'LEC',title:'Cranial Nerves IX and X'},[other,numeric])).toBe(numeric);
 expect(matchLectureToSection({activity:'LEC',title:'CN 5 and 7'},[numeric])).toBeNull();
});
