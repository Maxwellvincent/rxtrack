import {it,expect} from 'vitest';
import {mapAnsweredLectureQuestions,applyAnsweredLectureMappings} from './answerLectureMapping.js';
const lectures=[{id:'larynx',blockId:'NB',lectureTitle:'NB 16 Pharynx and Larynx',lectureNumber:16}];
const q={questionId:'q',stem:'Injury to the larynx causes paralysis of laryngeal muscles. Which laryngeal muscle is spared?',choices:{A:'Cricothyroid'},correct:'A'};
it('maps answered distinctive lecture content but never invents objective links or changes grades',()=>{
 const session={sessionId:'s',blockId:'NB',questions:[q,{...q,questionId:'unanswered'}],answers:[{questionId:'q',value:'A'}]};
 const changes=mapAnsweredLectureQuestions([session],lectures,'NB');expect(changes).toHaveLength(1);
 const next=applyAnsweredLectureMappings(session,changes);expect(next.questions[0].lectureId).toBe('larynx');expect(next.questions[0].objectiveIds).toBeUndefined();expect(next.answers).toEqual(session.answers);
});
it('keeps foreign-block content and ambiguous questions unchanged',()=>{
 expect(mapAnsweredLectureQuestions([{sessionId:'s',blockId:'ER',questions:[q],answers:[{questionId:'q',value:'A'}]}],lectures,'NB')).toEqual([]);
 expect(mapAnsweredLectureQuestions([{sessionId:'s',blockId:'NB',questions:[{...q,stem:'Which structure is affected?'}],answers:[{questionId:'q',value:'A'}]}],lectures,'NB')).toEqual([]);
});
