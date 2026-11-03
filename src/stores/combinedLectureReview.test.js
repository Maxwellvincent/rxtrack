import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({docs:{},writes:[],fail:false}));
vi.mock('../firebase.js',()=>({db:{}}));
vi.mock('firebase/firestore',()=>({doc:(_, ...path)=>path.at(-1),serverTimestamp:()=>1,runTransaction:async(_,fn)=>{
 const staged=[];
 const result=await fn({get:async ref=>({exists:()=>!!state.docs[ref],data:()=>({data:state.docs[ref]})}),set:(ref,value)=>staged.push([ref,value.data])});
 if(state.fail)throw Error('Offline');
 for(const [ref,value] of staged)state.docs[ref]=value;
 state.writes=staged;return result;
}}));
import {recordCombinedLectureReview} from './modelRetrieval.js';
import {recordLectureNotes} from '../engine/lectureNotesReview.js';
import {lectureReviewStats} from '../shell/features/lectures/lectureReviewStats.js';
it('commits one slide and notes session together and deduplicates retry',async()=>{
 state.docs={};state.fail=false;
 const input={blockId:'b',lectureId:'l',title:'Lecture'},at=Date.now();
 const save=()=>recordCombinedLectureReview('u',input,data=>recordLectureNotes(data,input,at,'same'),at,'same');
 await save();await save();
 const completion=Object.values(state.docs).find(data=>data.l__b).l__b;
 const model=Object.values(Object.values(state.docs).find(data=>data.models).models)[0];
 expect(completion.sessionCount).toBe(1);expect(lectureReviewStats(completion).count).toBe(1);
 expect(model.notesCompletions).toHaveLength(1);expect(model.history).toHaveLength(0);
 expect(completion.reviewDates).toHaveLength(1);
 state.fail=true;const before=JSON.stringify(state.docs);
 await expect(recordCombinedLectureReview('u',input,data=>recordLectureNotes(data,input,at,'new'),at,'new')).rejects.toThrow('Offline');
 expect(JSON.stringify(state.docs)).toBe(before);
});

it('clears the completion queue when a lecture model has no routine review',async()=>{
 state.docs={};state.fail=false;
 const input={blockId:'b',lectureId:'l',title:'Lecture'},at=Date.now();
 await recordCombinedLectureReview('u',input,data=>{
  const next=recordLectureNotes(data,input,at,'released');
  Object.values(next.models)[0].nextReviewAt=null;return next;
 },at,'released');
 const completion=Object.values(state.docs).find(data=>data.l__b).l__b;
 expect(completion.reviewDates).toEqual([]);
});
