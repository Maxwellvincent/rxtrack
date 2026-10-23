import {useMemo,useSyncExternalStore} from 'react';
import * as calibration from '../../stores/calibrationByBlock.js';
import * as evidence from '../../stores/learnerEvidence.js';
import * as ratings from '../../stores/questionRatings.js';
import {useStoreResource} from './useStoreResource.js';
import {useLectures} from './useLectures.js';
import {practiceAnswerHistory} from '../features/exam/practiceAnswerHistory.js';
export function useStudyAnswerHistory(userId,blockId){
 const snapshot=useSyncExternalStore(calibration.subscribe,()=>JSON.stringify(calibration.readBlock(userId,blockId)),()=>"[]");
 const entries=useMemo(()=>{try{return JSON.parse(snapshot||'[]');}catch{return [];}},[snapshot]);
 const history=useStoreResource(evidence,userId),quality=useStoreResource(ratings,userId),lectures=useLectures(blockId,userId);
 const result=useMemo(()=>practiceAnswerHistory(entries,history.data||{},blockId,(lectures.data||[]).filter(l=>l.blockId===blockId).map(l=>l.id),quality.data?.ratings||{}),[entries,history.data,blockId,lectures.data,quality.data]);
 return {...result,loading:history.loading||lectures.loading||quality.loading,error:history.error||lectures.error||quality.error};
}
