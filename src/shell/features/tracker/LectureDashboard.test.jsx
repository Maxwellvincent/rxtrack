// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {LectureDashboard} from './LectureDashboard.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('keeps six vertical choices visible and selects a lecture for actions',()=>{
 const host=document.createElement('div'),root=createRoot(host),study=vi.fn(),quiz=vi.fn();
 const rows=Array.from({length:6},(_,i)=>({lectureId:`l${i}`,title:`Lecture ${i}`,type:'LEC',number:i,total:4,covered:i%5,remaining:4-i%5,done:i===4}));
 act(()=>root.render(<LectureDashboard rows={rows} allRows={rows} onStudy={study} onQuiz={quiz} />));
 expect(host.querySelectorAll('.lecture-dashboard-bar-card')).toHaveLength(6);
 act(()=>host.querySelectorAll('.lecture-dashboard-bar-card')[2].click());
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Study →').click());
 expect(study).toHaveBeenCalledWith('l2');act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Quiz →').click());expect(quiz).toHaveBeenCalledWith(rows[2]);expect(host.textContent).toContain('Completion means every objective');act(()=>root.unmount());
});
