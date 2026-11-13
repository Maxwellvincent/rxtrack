// @vitest-environment jsdom
import React,{act,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {LecturePanel} from './LectureWorkspaceNav.jsx';
import {useLectureWorkspace,lectureWorkspaceReducer} from './useLectureWorkspace.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('defers tools until visited and preserves a draft when returning',()=>{
 const mount=vi.fn(),unmount=vi.fn();
 function Tool(){const [draft,setDraft]=useState('');useEffect(()=>{mount();return unmount;},[]);return <button onClick={()=>setDraft('Saved draft')}>{draft||'Edit draft'}</button>;}
 function Workspace(){const [workspace,activate,visited]=useLectureWorkspace();return <><button onClick={()=>activate('sources')}>Sources</button><button onClick={()=>activate('practice')}>Practice</button><LecturePanel name="sources" workspace={workspace} visited={visited}><Tool/></LecturePanel></>;}
 const host=document.createElement('div'),root=createRoot(host);act(()=>root.render(<Workspace/>));expect(mount).not.toHaveBeenCalled();
 act(()=>host.querySelector('button').click());expect(mount).toHaveBeenCalledTimes(1);
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Edit draft').click());
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Practice').click());expect(host.querySelector('section').hidden).toBe(true);expect(unmount).not.toHaveBeenCalled();
 act(()=>host.querySelector('button').click());expect(host.textContent).toContain('Saved draft');expect(mount).toHaveBeenCalledTimes(1);act(()=>root.unmount());
});
it('ignores invalid destinations and preserves visited identity on a no-op',()=>{
 const state={active:'practice',visited:['practice']};expect(lectureWorkspaceReducer(state,'wrong')).toBe(state);expect(lectureWorkspaceReducer(state,'practice')).toBe(state);
});
