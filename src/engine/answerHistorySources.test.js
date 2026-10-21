import {it,expect} from 'vitest';
import {recoverAnswerSource,historySourceQuestions} from './answerHistorySources.js';
const stem='A patient presents with a lesion of the recurrent laryngeal nerve following thyroid surgery and has persistent hoarseness. Which muscle is spared?';
const objectives=[{id:'o',code:'SOM.NB.16',linkedLecId:'l',objective:'Describe the intrinsic laryngeal muscles and their innervation.'}];
const q={id:'saved',stem,lectureId:'l',objectiveIds:['o'],choices:{A:'Cricothyroid'},correct:'A'};
it('restores a truncated legacy log using an exact unique source prefix',()=>{
 const result=recoverAnswerSource({stem:stem.slice(0,100),correct:false},[q],objectives);
 expect(result.record.questionKey).toBe('saved');expect(result.record.objectiveIds).toEqual(['o']);expect(result.record.correct).toBe(false);
});
it('does not resolve ambiguous or short snippets',()=>{
 expect(recoverAnswerSource({stem:stem.slice(0,100)},[q,{...q,id:'other',objectiveIds:['other'],lectureId:'other'}],objectives).basis).toBe('ambiguous-saved-item');
 expect(recoverAnswerSource({stem:'Laryngeal nerve'},[q],objectives).basis).toBe(null);
});
it('restores changed IDs only when full objective wording matches inside the same lecture',()=>{
 expect(recoverAnswerSource({stem},[{...q,objectiveIds:['stale'],objectiveTexts:[objectives[0].objective]}],objectives).record.objectiveIds).toContain('o');
 expect(recoverAnswerSource({stem},[{...q,lectureId:'wrong',objectiveIds:[],objectiveTexts:[objectives[0].objective]}],objectives).record.objectiveIds).not.toContain('o');
});
it('does not trust unconfirmed bank objective hints or foreign generated pools',()=>{
 const questions=historySourceQuestions({generated:{foreign:{questions:[q]}},banks:{'Homework.pdf':[{...q,curriculumLinkStatus:'candidate'}]},lectures:[{id:'l',blockId:'NB'}],blockId:'NB'});
 expect(questions).toHaveLength(1);expect(questions[0].objectiveIds).toEqual([]);
});
it('prefers source text over reused local IDs and excludes other blocks',()=>{
 const foreign={...q,id:'q1',stem:'An unrelated question '.repeat(8),lectureId:'wrong',blockId:'DM'};
 expect(recoverAnswerSource({id:'q1',stem},[foreign,{...q,id:'q2'}],objectives).record.lectureId).toBe('l');
 expect(historySourceQuestions({banks:{bank:[foreign]},lectures:[{id:'l',blockId:'NB'}],blockId:'NB'})).toEqual([]);
});
