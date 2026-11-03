// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import {LectureWorkspaceNav} from './LectureWorkspaceNav.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('provides four task-based sections with a single selected destination',()=>{
 function Workspace(){const [value,setValue]=useState('practice');return <LectureWorkspaceNav value={value} onChange={setValue}/>;}
 const host=document.createElement('div'),root=createRoot(host);act(()=>root.render(<Workspace/>));
 expect([...host.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['Practice','Learn','Progress','Sources & tools']);
 expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Progress').click());
 expect(host.querySelector('[aria-pressed="true"]').textContent).toBe('Progress');
 act(()=>root.unmount());
});
