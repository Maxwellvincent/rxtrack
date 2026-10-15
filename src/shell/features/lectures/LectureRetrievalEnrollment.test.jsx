import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,it,expect,vi} from 'vitest';
import {installDomStorage} from '../../../stores/testEnv.js';
const state=vi.hoisted(()=>({data:null,fail:false}));
vi.mock('../../hooks/useStoreResource.js',()=>({useStoreResource:()=>({data:state.data,loading:false,error:null})}));
vi.mock('../../../stores/modelRetrieval.js',()=>({retrievalStore:{update:async(_,transform)=>{if(state.fail)throw Error('Offline');state.data=transform(state.data);}}}));
import {LectureRetrievalEnrollment} from './LectureRetrievalEnrollment.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{installDomStorage();state.data={settings:{},models:{}};state.fail=false;});
function mount(){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);act(()=>root.render(<LectureRetrievalEnrollment userId="u" blockId="b" lectureId="l" title="Lecture" reference="Saved framework"/>));return {host,close:()=>act(()=>root.unmount())};}
it('requires explicit confirmation and saves the linked lecture reference',async()=>{const {host,close}=mount();expect(Object.keys(state.data.models)).toHaveLength(0);await act(async()=>host.querySelector('button').click());expect(host.textContent).toContain('Completed');expect(Object.values(state.data.models)[0]).toMatchObject({lectureId:'l',blockId:'b',reference:'Saved framework'});expect(host.textContent).toContain('Review notes / model');
expect(Object.values(state.data.models)[0].notesCompletions).toHaveLength(1);close();});
it('retains the enrollment action on save failure',async()=>{state.fail=true;const {host,close}=mount();await act(async()=>host.querySelector('button').click());expect(host.textContent).toContain('Could not save: Offline');expect(host.querySelector('button').disabled).toBe(false);expect(Object.keys(state.data.models)).toHaveLength(0);close();});

it('supports logging later notes updates without replacing the saved reference',async()=>{const {host,close}=mount();await act(async()=>host.querySelector('button').click());const update=[...host.querySelectorAll('button')].find(b=>b.textContent==='Log notes update');await act(async()=>update.click());const model=Object.values(state.data.models)[0];expect(model.notesCompletions).toHaveLength(2);expect(model.reference).toBe('Saved framework');expect(model.history).toHaveLength(0);close();});
it('records a notes recall review without turning completion into mastery',async()=>{
 const {host,close}=mount();
 await act(async()=>host.querySelector('button').click());
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Review notes / model').click());
 const grade=[...host.querySelectorAll('button')].find(b=>b.textContent==='Some gaps remain');
 expect(grade.disabled).toBe(true);
 await act(async()=>host.querySelector('input[type="checkbox"]').click());
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Some gaps remain').click());
 const model=Object.values(state.data.models)[0];
 expect(model.history).toHaveLength(1);
 expect(model.history[0].grade).toBe('shaky');
 expect(model.notesCompletions).toHaveLength(1);
 expect(host.textContent).toContain('1 reviews');
 close();
});
