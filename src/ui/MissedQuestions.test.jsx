// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {MissedQuestions} from './MissedQuestions.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('keeps large histories collapsed and paginated while replay retains every missed question',()=>{
 const host=document.createElement('div'),root=createRoot(host),onReplay=vi.fn();
 const learningJournal=Array.from({length:200},(_,i)=>({at:i+1,correct:false,lectureId:'l',blockId:'b',learningContext:{stem:`Question ${i}`,topic:`Concept ${i}`,choices:{A:'One',B:'Two'},correctLetter:'A'}}));
 act(()=>root.render(<MissedQuestions evidence={{learningJournal}} blockId="b" onReplay={onReplay}/>));
 expect(host.querySelector('details').open).toBe(false);
 expect(host.querySelectorAll('[aria-label="Missed concept groups"] > li')).toHaveLength(5);
 expect(host.querySelector('[aria-label="Missed concept groups"]').className).toContain('overflow-y-auto');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Next groups').click());
 expect(host.textContent).toContain('Groups 6–10 of 200');
 expect(host.querySelectorAll('[aria-label="Missed concept groups"] > li')).toHaveLength(5);
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent.startsWith('Redo all')).click());
 expect(onReplay.mock.calls[0][0]).toHaveLength(200);
 act(()=>root.unmount());
});
