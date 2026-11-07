import {it,expect} from 'vitest';import {recoverQuizHistory} from './recoverQuizHistory.js';
const opts={blockId:'b',lectures:[{id:'l',blockId:'b'}],objectives:[{id:'o',linkedLecId:'l'}]};
const record={blockId:'b',lectureId:'l',sessionKey:'s',questionKey:'q',ts:1000,correct:true,objectiveIds:['o','unknown']};
it('recovers actual saved answers with only explicit catalog links and is idempotent',()=>{const events=recoverQuizHistory([record],[],opts);expect(events).toHaveLength(1);expect(events[0].objectiveIds).toEqual(['o']);expect(recoverQuizHistory([record],events,opts)).toEqual([]);});
it('keeps lecture-level answers even without objective links',()=>{expect(recoverQuizHistory([{...record,objectiveIds:[]}],[],opts)[0].objectiveIds).toEqual([]);});
it('does not duplicate a legacy mirror with a different key or admit another block',()=>{expect(recoverQuizHistory([record],[{...record,questionKey:'pool-id',at:1001}],opts)).toEqual([]);expect(recoverQuizHistory([{...record,blockId:'other'}],[],opts)).toEqual([]);});
