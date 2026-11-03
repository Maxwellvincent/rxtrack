// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import {useLectureStats} from './useLectureQuestionStats.js';
import {__setCloudBackendForTests,resetCloudStores} from '../../stores/cloudBase.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('updates a mounted lecture after dependent history hydrates and remote counts change',()=>{
 const listeners=new Map();
 __setCloudBackendForTests({doc:(_db,...parts)=>parts.join('/'),onSnapshot:(path,next)=>{listeners.set(path,next);return ()=>listeners.delete(path);},setDoc:()=>Promise.resolve(),serverTimestamp:()=>0});
 const user='live-counts';
 function Counts(){const stats=useLectureStats(user,'l');return <p>{stats.loading?'loading':`${stats.answered} answered · ${stats.correct} correct`}</p>;}
 const host=document.createElement('div'),root=createRoot(host);
 const emit=(key,data)=>act(()=>listeners.get(`users/${user}/kv/${key}`)({exists:()=>true,data:()=>({data}),metadata:{fromCache:true}}));
 try{
  act(()=>root.render(<Counts/>));expect(host.textContent).toBe('loading');
  emit('rxt-lecture-qstats',{l:{answered:8,correct:6}});expect(host.textContent).toBe('loading');
  emit('rxt-learner-evidence-v1',{evidenceJournal:[]});expect(host.textContent).toBe('loading');
  emit('rxt-question-ratings-v1',{ratings:{}});expect(host.textContent).toBe('8 answered · 6 correct');
  emit('rxt-lecture-qstats',{l:{answered:10,correct:7}});expect(host.textContent).toBe('10 answered · 7 correct');
  emit('rxt-learner-evidence-v1',{evidenceJournal:[{eventId:'pending',questionKey:'q',lectureId:'l',pendingLectureStats:true,correct:true}]});
  expect(host.textContent).toBe('11 answered · 8 correct');
 }finally{act(()=>root.unmount());resetCloudStores();__setCloudBackendForTests(null);}
});
