import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {installDomStorage} from '../../../stores/testEnv.js';
vi.mock('../../hooks/useLectureQuestionStats.js',()=>({useLectureQuestionStats:()=>({data:{a:{answered:20,correct:5},b:{answered:20,correct:10},c:{answered:20,correct:18}},loading:false})}));
import {ExamSprintCard} from './ExamSprintCard.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('shows two actionable priorities tomorrow, without an exam-score claim, and hides outside the final day',()=>{
 installDomStorage();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const context={blockId:'NB',blockMeta:{name:'NB 1'},lectures:['a','b','c'].map(id=>({id,blockId:'NB',lectureTitle:`Lecture ${id}`})),objectives:['a','b','c'].map(id=>({id:'o'+id,linkedLecId:id,discipline:'anatomy'})),learnerEvidence:{}};
 const onStudy=vi.fn(),onQuiz=vi.fn();
 act(()=>root.render(<ExamSprintCard context={context} daysLeft={1} onStudy={onStudy} onQuiz={onQuiz}/>));
 expect(host.querySelectorAll('article')).toHaveLength(2);expect(host.textContent).toContain('not guaranteed marks gained');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Review lecture').click());expect(onStudy).toHaveBeenCalledWith('a');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Practice questions').click());expect(onQuiz.mock.calls[0][0].lec.id).toBe('a');
 act(()=>root.render(<ExamSprintCard context={context} daysLeft={4}/>));expect(host.textContent).toBe('');act(()=>root.unmount());
});
