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
it('reserves a coverage slot and stays inside the selected time budget without NB1 spillover',()=>{
 const rows=examSprintPriorities({...data,availableMinutes:30,objectives:[...data.objectives,{id:'new',linkedLecId:'b',discipline:'anatomy',status:'untested'}]});
 expect(rows.reduce((n,r)=>n+r.minutes,0)).toBeLessThanOrEqual(30);
 expect(rows.every(row=>row.questionCount===5)).toBe(true);
 expect(rows.every(row=>row.lectureId!=='d')).toBe(true);
});

it('focuses coverage on unanswered objectives rather than stale untested labels',()=>{
 const rows=examSprintPriorities({blockId:'NB',lectures:[{id:'a',blockId:'NB'}],objectives:[{id:'seen',linkedLecId:'a',status:'untested'},{id:'unseen',linkedLecId:'a',status:'mastered'}],learnerEvidence:{objectives:{seen:{attempts:1,correct:1,recent:[true]},unseen:{attempts:0,correct:0}}}});
 expect(rows[0].action).toBe('coverage');expect(rows[0].focusObjectiveIds).toEqual(['unseen']);
});
it('targets a new miss and does not select a recovered objective by its stale struggling label',()=>{
 const rows=examSprintPriorities({blockId:'NB',lectures:[{id:'a',blockId:'NB'}],objectives:[{id:'recovered',linkedLecId:'a',status:'struggling'},{id:'miss',linkedLecId:'a',status:'mastered'}],questionStats:{a:{answered:10,correct:5}},learnerEvidence:{objectives:{recovered:{attempts:5,correct:5,recent:[true,true,true,true,true]},miss:{attempts:1,correct:0,recent:[false]}}}});
 expect(rows[0].action).toBe('repair');expect(rows[0].focusObjectiveIds).toEqual(['miss']);
});
it('does not prescribe broad repair for a recovered 85% lecture while weaker lectures remain',()=>{
 const rows=examSprintPriorities({...data,exam:null,learnerEvidence:{...data.learnerEvidence,lectures:{a:{recent:[true,false,false,false,false,false,true,false],lastSeen:1000}}},questionStats:{...data.questionStats,a:{answered:39,correct:27,recentAnswers:Array.from({length:20},(_,i)=>({correct:i<17,at:1000+i}))}}});
 expect(rows.some(r=>r.lectureId==='a')).toBe(false);
});
it('recomputes an assisted repair handoff from saved NB2 evidence and releases its priority after independent application',()=>{
 const now=Date.now(),anchor={at:now-10000,questionKey:'old',sessionKey:'s',objectiveIds:['ob'],lectureId:'b',blockId:'NB',correct:true,assisted:true,learningContext:{topic:'Crossing'}};
 const input={...data,lectures:data.lectures.filter(l=>l.id==='b'),exam:null,learnerEvidence:{...data.learnerEvidence,assistedJournal:[anchor]}};
 const pending=examSprintPriorities(input).find(r=>r.lectureId==='b');expect(pending?.repairConnections).toBe(1);expect(pending.focusObjectiveIds).toContain('ob');
 const success={...anchor,at:now-1000,questionKey:'fresh',correct:true,assisted:false,reasoningVerified:true,orderLevel:'second-order'};
 expect(examSprintPriorities({...input,learnerEvidence:{...input.learnerEvidence,learningJournal:[success]}}).find(r=>r.lectureId==='b')?.repairConnections||0).toBe(0);
});
