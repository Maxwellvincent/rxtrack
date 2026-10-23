import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import * as calibrationStore from '../../stores/calibrationByBlock.js';
import {manualPracticeStore} from '../../stores/manualPractice.js';
import * as questionRatings from '../../stores/questionRatings.js';
import {useStoreResource} from './useStoreResource.js';
import {listExamSessions} from '../../supabase.js';
import {scoredSessionSnapshot} from '../features/exam/checkpoint.js';
/** Daily and lifetime cards use the same saved-answer sources as exam progress. */
export function useQuestionPractice(userId,blockId){
 const snapshot=useSyncExternalStore(calibrationStore.subscribe,()=>JSON.stringify(calibrationStore.readBlock(userId,blockId)),()=>"[]");
 const studyAnswers=useMemo(()=>{try{return JSON.parse(snapshot||'[]');}catch{return [];}},[snapshot]);
 const manual=useStoreResource(manualPracticeStore,userId);
 const [result,setResult]=useState(null);
 const key=`${userId||'local'}:${blockId}`;
 useEffect(()=>{
  let active=true,revision=0;
  const refresh=()=>{const request=++revision;listExamSessions(userId,blockId).then(rows=>{if(active&&request===revision)setResult({key,sessions:(rows||[]).map(s=>scoredSessionSnapshot(s,questionRatings.read(userId).ratings)).filter(Boolean),error:false});}).catch(()=>{if(active&&request===revision)setResult({key,sessions:[],error:true});});};
  refresh(); window.addEventListener('focus',refresh);const timer=setInterval(refresh,60000);
  const unsubscribe=questionRatings.subscribe(refresh);
  return()=>{active=false;window.removeEventListener('focus',refresh);clearInterval(timer);unsubscribe();};
 },[userId,blockId,key]);
 return {studyAnswers,sessions:result?.key===key?result.sessions:[],manualEntries:manual.data?.[blockId]||[],loading:result?.key!==key||manual.loading,error:result?.key===key&&result.error||manual.error};
}
