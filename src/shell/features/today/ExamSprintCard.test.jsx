import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {installDomStorage} from '../../../stores/testEnv.js';
vi.mock('../../hooks/useLectureQuestionStats.js',()=>({useLectureQuestionStats:()=>({data:{a:{answered:20,correct:5},b:{answered:20,correct:10},c:{answered:20,correct:18}},loading:false})}));
vi.mock('../../hooks/useQuestionPractice.js',()=>({useQuestionPractice:()=>({sessions:[],loading:false,error:null})}));
import {ExamSprintCard} from './ExamSprintCard.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('shows two actionable priorities tomorrow, without an exam-score claim, and hides outside the final day',()=>{
 installDomStorage();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const context={blockId:'NB',blockMeta:{name:'NB 1'},lectures:['a','b','c'].map(id=>({id,blockId:'NB',lectureTitle:`Lecture ${id}`})),objectives:['a','b','c'].map(id=>({id:'o'+id,linkedLecId:id,discipline:'anatomy'})),learnerEvidence:{}};
 const onStudy=vi.fn(),onQuiz=vi.fn();
 act(()=>root.render(<ExamSprintCard context={context} daysLeft={1} onStudy={onStudy} onQuiz={onQuiz}/>));
 expect(host.querySelectorAll('article')).toHaveLength(2);expect(host.textContent).toContain('not guaranteed marks gained');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Review lecture').click());expect(onStudy).toHaveBeenCalledWith('a');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='15-question set').click());expect(onQuiz.mock.calls[0][0].lec.id).toBe('a');
 act(()=>root.render(<ExamSprintCard context={context} daysLeft={4}/>));expect(host.textContent).toBe('');act(()=>root.unmount());
});
it('keeps NB2 preparation visible ahead of the final day and passes a time-sized quiz request',()=>{
 installDomStorage();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const onQuiz=vi.fn();
 const context={blockId:'nb2',blockMeta:{name:'NB 2'},lectures:['a','b'].map(id=>({id,blockId:'nb2',lectureTitle:id})),objectives:['a','b'].map(id=>({id:'o'+id,linkedLecId:id}))};
 act(()=>root.render(<ExamSprintCard context={context} daysLeft={10} onQuiz={onQuiz} onStudy={()=>{}}/>));
 expect(host.textContent).toContain('Target: 80%');expect(host.querySelectorAll('article')).toHaveLength(2);
 const select=host.querySelector('[aria-label="Study time available"]');
 act(()=>{select.value='30';select.dispatchEvent(new Event('change',{bubbles:true}));});
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='5-question set').click());
 expect(onQuiz.mock.calls[0][0]).toMatchObject({questionCount:5,matchReason:'exam-coverage'});
 act(()=>root.unmount());
});
