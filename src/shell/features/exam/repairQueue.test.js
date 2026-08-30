import {it,expect} from 'vitest';
import {repairActivity} from './repairQueue.js';
const now=new Date(2026,7,30,12).getTime();
const sessions=[{submittedAt:now-86400000,questions:[{lectureId:'a'}]}];
it('recognizes follow-up practice but retains outstanding gaps',()=>{expect(repairActivity('a',sessions,{a:{attempts:[{at:now-1000,correct:true}]}},{a:{x:{status:'needs-review'},y:{status:'complete'}}},now)).toEqual({workedToday:true,followupQuestions:1,remainingRepairs:1});});
it('does not clear a new exam weakness using older practice',()=>{expect(repairActivity('a',[{...sessions[0],submittedAt:now}],{a:{attempts:[{at:now-1000}]}},{},now).workedToday).toBe(false);});
it('returns yesterday’s work to the active queue today',()=>{expect(repairActivity('a',[],{a:{attempts:[{at:now-86400000}]}},{},now).workedToday).toBe(false);});
it('recognizes an explicitly recorded model review',()=>{expect(repairActivity('a',sessions,{a:{lastReviewedAt:now}},{},now).workedToday).toBe(true);});
