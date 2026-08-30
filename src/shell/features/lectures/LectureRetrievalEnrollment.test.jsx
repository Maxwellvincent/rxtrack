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
it('requires explicit confirmation and saves the linked lecture reference',async()=>{const {host,close}=mount();expect(Object.keys(state.data.models)).toHaveLength(0);await act(async()=>host.querySelector('button').click());expect(host.textContent).toContain('Model created · in retrieval');expect(Object.values(state.data.models)[0]).toMatchObject({lectureId:'l',blockId:'b',reference:'Saved framework'});expect(host.querySelector('button')).toBeNull();close();});
it('retains the enrollment action on save failure',async()=>{state.fail=true;const {host,close}=mount();await act(async()=>host.querySelector('button').click());expect(host.textContent).toContain('Could not save: Offline');expect(host.querySelector('button').disabled).toBe(false);expect(Object.keys(state.data.models)).toHaveLength(0);close();});
