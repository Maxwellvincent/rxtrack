import {it,expect} from 'vitest';
import {examSprintPriorities} from './examSprint.js';
const data={blockId:'NB',lectures:['a','b','c','d'].map(id=>({id,blockId:id==='d'?'ER':'NB',lectureTitle:id})),objectives:['a','b','c','d'].map(id=>({id:'o'+id,linkedLecId:id,discipline:id==='c'?'histology':'anatomy'})),questionStats:{a:{answered:20,correct:6},b:{answered:20,correct:16},c:{answered:20,correct:6},d:{answered:20,correct:0}},learnerEvidence:{objectives:Object.fromEntries(['a','b','c','d'].map(id=>['o'+id,{attempts:20,correct:10}]))},exam:3};
it('returns only two scoped priorities and favours high-weight demonstrated weakness',()=>{
 const rows=examSprintPriorities(data);expect(rows.map(r=>r.lectureId)).toEqual(['a','c']);expect(rows[0].minutes).toBeGreaterThanOrEqual(20);expect(rows[0].minutes).toBeLessThanOrEqual(45);
});
it('uses recent recovery instead of permanently prioritizing old mistakes',()=>{
 const rows=examSprintPriorities({...data,learnerEvidence:{...data.learnerEvidence,lectures:{a:{recent:[true,true,true,true,true,true,true,true]}}}});
 expect(rows[0].lectureId).toBe('c');
 expect(rows.every(row=>row.lectureId!=='a')).toBe(true);
});
it('does not let one wrong answer outweigh established weak evidence',()=>{
 const rows=examSprintPriorities({...data,questionStats:{...data.questionStats,b:{answered:1,correct:0}}});expect(rows[0].lectureId).toBe('a');
});
it('does not invent an exact predicted exam score',()=>{expect(examSprintPriorities(data)[0]).not.toHaveProperty('predictedScore');});
