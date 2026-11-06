import {it,expect} from 'vitest';
import {lectureTrend} from './lectureTrend.js';
const at=s=>Date.parse(s),scope={blockId:'b',lectureId:'l',timeZone:'America/Grenada'};
const event=(id,correct,date)=>({eventId:id,blockId:'b',lectureId:'l',questionKey:id,correct,at:at(date)});
it('plots daily and weighted running accuracy from dated events, preserving retakes and skipping duplicate saves',()=>{
 const a=event('a',true,'2026-11-01T12:00Z'),b=event('b',false,'2026-11-01T13:00Z'),c=event('c',true,'2026-11-03T12:00Z');
 const points=lectureTrend({evidenceJournal:[a,a,b,c] },scope);
 expect(points).toHaveLength(2);expect(points[0]).toMatchObject({day:'2026-11-01',answered:2,accuracy:50});expect(points[1].runningAccuracy).toBeCloseTo(66.6667);expect(points[1].accuracy).toBe(100);
});
it('does not invent points for undated totals, other lectures, blocks or unscored events',()=>{
 expect(lectureTrend({total:40,correct:30,evidenceJournal:[{...event('a',true,'2026-11-01'),blockId:'x'}, {...event('b',true,'2026-11-01'),lectureId:'x'}, {...event('c',true,'2026-11-01'),at:0}, {...event('d',true,'2026-11-01'),correct:null}]},scope)).toEqual([]);
});
it('uses the learner timezone and omits performance-excluded questions',()=>{
 const e=event('a',true,'2026-11-02T02:00Z');expect(lectureTrend({evidenceJournal:[e]},scope)[0].day).toBe('2026-11-01');
 expect(lectureTrend({evidenceJournal:[e]}, {...scope,ratings:{a:{sourceIssue:'incorrect-key',evidenceKey:'a'}}})).toEqual([]);
});
