import {useState} from 'react';
import {Button} from '../../../ui/Button.jsx';
import {linkSourceLecture} from './questionBankLinks.js';
import {formatLectureLabel} from '../../../lectureTitle.js';
export function missedPracticeGroups(questions,lectures=[],blockId){
 const groups=new Map(),byId=new Map(lectures.filter(l=>l.blockId===blockId).map(l=>[l.id,l]));
 for(const question of questions){
  const q=linkSourceLecture(question,lectures,blockId);
  const lecture=byId.get(q.lectureId);
  const confirmed=['user-confirmed','evidence-verified','source-label-matched','content-matched'].includes(q.curriculumLinkStatus);
  const key=lecture&&confirmed?`lecture:${lecture.id}`:q.sourceSection?`section:${q.sourceSection}`:'unassigned';
  const label=lecture&&confirmed?formatLectureLabel(lecture):q.sourceSection?[q.sourceSectionTitle,q.sourceSection].filter(Boolean).join(' · '):'Lecture not confirmed';
  if(!groups.has(key))groups.set(key,{key,label,questions:[]});
  groups.get(key).questions.push(question);
 }
 return [...groups.values()];
}
export function MissedPracticeActions({questions,lectures,blockId,busy,onLaunch}){
 const [selected,setSelected]=useState('all');
 const groups=missedPracticeGroups(questions,lectures,blockId);
 const chosen=groups.find(g=>g.key===selected);
 const subset=chosen?.questions||questions;
 if(!questions.length)return null;
 return <div className="flex min-w-0 self-start flex-col gap-1">
  <Button className="w-full min-w-0 whitespace-normal text-center leading-tight" variant="outline" disabled={busy} onClick={()=>onLaunch(subset)}>Practice missed · {subset.length}</Button>
  <details className="min-w-0 text-xs text-text-2"><summary className="cursor-pointer py-2 leading-tight">Choose missed lecture or section</summary><label className="block">Missed-question scope<select aria-label="Missed-question scope" className="mt-1 w-full min-w-0 rounded border border-border bg-bg p-2" value={chosen?selected:'all'} onChange={e=>setSelected(e.target.value)}><option value="all">All missed in this bank · {questions.length}</option>{groups.map(g=><option key={g.key} value={g.key}>{g.label} · {g.questions.length}</option>)}</select></label><p className="mt-1">Source sections stay grouped when a lecture link is not confirmed.</p></details>
 </div>;
}
