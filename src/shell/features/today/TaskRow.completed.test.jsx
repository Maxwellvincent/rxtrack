import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {installDomStorage} from '../../../stores/testEnv.js';
import {TaskRow} from './Today.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('opens a completed lecture without toggling its completion',()=>{
 installDomStorage();
 const host=document.createElement('div');const root=createRoot(host);
 const onStudy=vi.fn(),onCheck=vi.fn();
 act(()=>root.render(<TaskRow task={{lec:{id:'l',lectureTitle:'Somatosensory'},total:0}} checked onStudy={onStudy} onCheck={onCheck} onQuiz={vi.fn()}/>));
 const title=[...host.querySelectorAll('button')].find(b=>b.textContent==='Somatosensory');
 act(()=>title.click());
 const open=[...host.querySelectorAll('button')].find(b=>b.textContent==='Open / review →');
 expect(open).toBeTruthy();act(()=>open.click());
 expect(onStudy).toHaveBeenCalledTimes(2);expect(onStudy).toHaveBeenCalledWith('l');expect(onCheck).not.toHaveBeenCalled();
 act(()=>root.unmount());
});
