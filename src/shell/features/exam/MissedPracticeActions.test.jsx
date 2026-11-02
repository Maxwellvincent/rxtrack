import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi} from 'vitest';import {installDomStorage} from '../../../stores/testEnv.js';import {MissedPracticeActions,missedPracticeGroups} from './MissedPracticeActions.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const lectures=[{id:'l27',blockId:'nb2',lectureNumber:27,lectureTitle:'Section Anatomy of the CNS'},{id:'l31',blockId:'nb2',lectureNumber:31,lectureTitle:'Motor System'}];
const questions=[{id:'a',stem:'Unique q',lectureId:'l27',curriculumLinkStatus:'user-confirmed'},{id:'b',stem:'Other q',lectureId:'l31',curriculumLinkStatus:'user-confirmed'},{id:'c',stem:'Unmapped q',sourceSection:'NB 28 / NB 29 / NB 30',sourceSectionTitle:'Somatosensory System, Touch and Pain'}];
it('groups confirmed lectures separately while retaining shared source sections without inventing a lecture',()=>{
 const groups=missedPracticeGroups(questions,lectures,'nb2');expect(groups.map(g=>g.key)).toEqual(['lecture:l27','lecture:l31','section:NB 28 / NB 29 / NB 30']);expect(groups[0].label).toContain('Section Anatomy');expect(questions[2].lectureId).toBeUndefined();
});
it('launches only the chosen lecture misses and keeps scope controls collapsed',()=>{
 installDomStorage();const host=document.createElement('div');const root=createRoot(host),launch=vi.fn();act(()=>root.render(<MissedPracticeActions questions={questions} lectures={lectures} blockId="nb2" onLaunch={launch}/>));expect(host.querySelector('details').open).toBe(false);
 const select=host.querySelector('select');act(()=>{select.value='lecture:l31';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(host.querySelector('button').textContent).toBe('Practice missed · 1');act(()=>host.querySelector('button').click());expect(launch).toHaveBeenCalledWith([questions[1]]);act(()=>root.unmount());
});
