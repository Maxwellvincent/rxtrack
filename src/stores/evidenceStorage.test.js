import {it,expect} from 'vitest';import {evidenceStorageValue} from './evidenceStorage.js';import {applyEvidence} from './learnerEvidence.js';
it('removes only replayable duplicate aggregates while preserving every original event and baseline',()=>{
 const baseline={total:1,correct:1,lectures:{l:{attempts:1,correct:1}}},event={lectureId:'l',objectiveIds:['o'],correct:false,at:10,questionKey:'q'};const full={...applyEvidence(baseline,event),evidenceBaseline:baseline,evidenceJournal:[event],learningNotes:[{note:'keep'}]};
 const saved=evidenceStorageValue('rxt-learner-evidence-v1',full);expect(saved.evidenceJournal).toEqual([event]);expect(saved.learningNotes).toEqual(full.learningNotes);expect(saved.objectives).toBeUndefined();expect(saved.evidenceJournal.reduce((m,e)=>applyEvidence(m,e),saved.evidenceBaseline).lectures).toEqual(full.lectures);expect(evidenceStorageValue('other',full)).toBe(full);
});
