// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect} from 'vitest';import {LectureProgressOverview} from './LectureProgressOverview.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('shows a real dated trend and one summary without nested review panels',()=>{
 const host=document.createElement('div'),root=createRoot(host);const props={blockId:'b',lectureId:'l',stats:{answered:41,correct:28},model:{evidenceJournal:[{eventId:'1',blockId:'b',lectureId:'l',questionKey:'a',correct:true,at:Date.parse('2026-11-06T12:00Z')}]},objectivePractice:{rows:[{id:'o',text:'Explain coordination',ready:false,state:'struggling',attempts:4,correct:2}]}};
 act(()=>root.render(<LectureProgressOverview {...props}/>));expect(host.textContent).toContain('41 questions answered · 68% correct');expect(host.querySelector('svg')).not.toBeNull();expect(host.textContent).toContain('Only answers with usable dates');expect(host.textContent).toContain('Explain coordination');expect(host.querySelectorAll('details')).toHaveLength(0);expect(host.querySelectorAll('circle')).toHaveLength(1);
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Running average');act(()=>button.click());expect(button.getAttribute('aria-pressed')).toBe('true');act(()=>root.unmount());
});
it('does not fabricate a flat chart from legacy aggregate counters',()=>{const host=document.createElement('div'),root=createRoot(host);act(()=>root.render(<LectureProgressOverview stats={{answered:40,correct:30}}/>));expect(host.querySelector('svg')).toBeNull();expect(host.textContent).toContain('No dated question history yet');act(()=>root.unmount());});
