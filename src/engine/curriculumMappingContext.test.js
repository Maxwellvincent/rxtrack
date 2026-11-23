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
it('prioritizes explicit lecture numbers without confusing week or block numbers',()=>{
 const local=[{id:'28',lectureNumber:28},{id:'29',lectureTitle:'NB 29 Touch'},{id:'12',lectureNumber:12,weekNumber:12}];
 expect(scheduleLectureCandidates({sourceSection:'NB 28 / NB 29',sourceTitle:'Week 12 NB2 Homework'},local).map(l=>l.id)).toEqual(['28','29']);
 expect(curriculumSourceContext({sourceTitle:'Week 12 NB2 Homework'}).lectureNumbers).toEqual([]);
});
it('keeps DLA identity separate from the same numbered lecture',()=>{const local=[{id:'lecture',lectureNumber:17,lectureTitle:'NB 17 Other topic'},{id:'dla',lectureType:'DLA',lectureTitle:'NB DLA 17 Sexual Dysfunctions - After NB 55'}];expect(scheduleLectureCandidates({sourceSectionTitle:'DLA 17'},local).map(l=>l.id)).toEqual(['dla']);expect(scheduleLectureCandidates({sourceSection:'NB 17'},local).map(l=>l.id)).toEqual(['lecture']);});
