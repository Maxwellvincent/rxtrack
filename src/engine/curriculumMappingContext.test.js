import {it,expect} from 'vitest';
import {curriculumSourceContext,scheduleLectureCandidates} from './curriculumMappingContext.js';
import {linkSourceLecture} from '../shell/features/exam/questionBankLinks.js';
const lectures=[{id:'one',blockId:'NB',termId:'T2',weekNumber:9,lectureTitle:'Pharynx and Larynx'},{id:'two',blockId:'NB',termId:'T2',weekNumber:10,lectureTitle:'Pharynx and Larynx'},{id:'old',blockId:'ER',weekNumber:9,lectureTitle:'Pharynx and Larynx'}];
it('extracts week headings and refuses conflicting weeks',()=>{
 expect(curriculumSourceContext({sourceTitle:'Week 09 homework'}).weekNumber).toBe(9);
 expect(scheduleLectureCandidates({sourceTitle:'Week 9',sourceSectionTitle:'Week 10'},lectures)).toEqual([]);
});
it('uses week plus distinctive content to resolve local ambiguity without objective credit',()=>{
 const q=linkSourceLecture({sourceTitle:'Week 9 homework',stem:'The larynx and pharynx are injured. Which laryngeal muscle is affected?'},lectures,'NB');
 expect(q.lectureId).toBe('one');expect(q.objectiveIds).toBeUndefined();
 expect(q.curriculumMapping).toMatchObject({blockId:'NB',termId:'T2',scope:'block',crossBlockCredit:false});
});
it('never maps by schedule alone',()=>{
 expect(linkSourceLecture({sourceTitle:'Week 9 homework',stem:'Which structure is affected?'},lectures,'NB').lectureId).toBeUndefined();
});
