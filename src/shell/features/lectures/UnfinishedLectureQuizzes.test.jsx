// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {UnfinishedLectureQuizzes} from './UnfinishedLectureQuizzes.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('surfaces the latest session and keeps older sessions accessible without changing their data',()=>{
 const sessions=[{id:'old',updatedAt:1,questions:[{}]},{id:'new',updatedAt:2,questions:[{},{}],progress:{records:[{correct:false}]}}];
 const original=JSON.stringify(sessions),onResume=vi.fn(),onDiscard=vi.fn(),host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<UnfinishedLectureQuizzes sessions={sessions} onResume={onResume} onDiscard={onDiscard}/>));
 const first=host.querySelector('button');act(()=>first.click());expect(onResume).toHaveBeenCalledWith(sessions[1]);
 expect(host.querySelector('details').open).toBe(false);expect(host.textContent).toContain('Other saved quizzes (1)');
 act(()=>[...host.querySelectorAll('details button')].at(-1).click());expect(onDiscard).toHaveBeenCalledWith(sessions[0]);expect(JSON.stringify(sessions)).toBe(original);act(()=>root.unmount());
});
