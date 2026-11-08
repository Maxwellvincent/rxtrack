import {readSessionHistory,invalidateSessionReads} from './sessionReadCache.js';
import {subscribeExamSessionChanges} from "../../examSessionChanges.js";
import {useCallback,useEffect,useState} from 'react';
import {useStudyAnswerHistory} from './useStudyAnswerHistory.js';
import {manualPracticeStore} from '../../stores/manualPractice.js';
import * as questionRatings from '../../stores/questionRatings.js';
import {useStoreResource} from './useStoreResource.js';
import {listExamSessions} from '../../supabase.js';
import {scoredSessionSnapshot} from '../features/exam/checkpoint.js';
// One invalidation before per-view subscriptions run; concurrent consumers share the next read.
subscribeExamSessionChanges(invalidateSessionReads);
if(typeof window!=='undefined')window.addEventListener('focus',()=>invalidateSessionReads());
/** Daily and lifetime cards use the same saved-answer sources as exam progress. */
export function useQuestionPractice(userId,blockId){
 const [refreshKey,setRefreshKey]=useState(0);
 const refresh=useCallback(()=>{invalidateSessionReads({userId,blockId});setRefreshKey(n=>n+1);},[userId,blockId]);
 const history=useStudyAnswerHistory(userId,blockId);
 const manual=useStoreResource(manualPracticeStore,userId);
 const [result,setResult]=useState(null);
 const key=`${userId||'local'}:${blockId}`;
 useEffect(()=>{
  let active=true,revision=0;
  const refresh=()=>{const request=++revision;readSessionHistory(userId,blockId,listExamSessions).then(rows=>{if(active&&request===revision)setResult({key,sessions:(rows||[]).map(s=>scoredSessionSnapshot(s,questionRatings.read(userId).ratings)).filter(Boolean),error:false});}).catch(()=>{if(active&&request===revision)setResult(previous=>({key,sessions:previous?.key===key?previous.sessions:[],error:true}));});};
  refresh(); window.addEventListener('focus',refresh);const timer=setInterval(refresh,60000);
  const unsubscribe=questionRatings.subscribe(refresh);
  const offSessions=subscribeExamSessionChanges(change=>{if(change.userId===userId&&(!change.blockId||change.blockId===blockId))refresh();});
  return()=>{active=false;window.removeEventListener('focus',refresh);clearInterval(timer);unsubscribe();offSessions();};
 },[userId,blockId,key,refreshKey]);
 return {...history,refresh,sessions:result?.key===key?result.sessions:[],manualEntries:manual.data?.[blockId]||[],loading:result?.key!==key||manual.loading||history.loading,error:result?.key===key&&result.error||manual.error||history.error};
}
