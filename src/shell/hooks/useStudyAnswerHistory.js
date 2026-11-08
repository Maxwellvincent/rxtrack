import {excludedEvidenceKeys,evidenceIdentity} from '../../engine/questionScoringPolicy.js';
import {recoverQuizHistory} from '../../engine/recoverQuizHistory.js';
import * as objectivesStore from '../../stores/blockObjectives.js';
import {selectBlockObjectives} from '../logic/objectives.js';
import {useEffect,useMemo,useState} from 'react';
import * as calibration from '../../stores/calibrationByBlock.js';
import * as evidence from '../../stores/learnerEvidence.js';
import * as ratings from '../../stores/questionRatings.js';
import {useStoreResource} from './useStoreResource.js';
import {useLectures} from './useLectures.js';
import {practiceAnswerHistory} from '../features/exam/practiceAnswerHistory.js';
export function useStudyAnswerHistory(userId,blockId){
 const calibrationResource=useStoreResource(calibration,userId);
 const history=useStoreResource(evidence,userId),quality=useStoreResource(ratings,userId),lectures=useLectures(blockId,userId);
 const entries=useMemo(()=>{const excluded=excludedEvidenceKeys(quality.data?.ratings||{});return (calibrationResource.data?.[blockId]||[]).filter(r=>!excluded.has(evidenceIdentity(r.questionKey||r.stem)));},[calibrationResource.data,quality.data,blockId]);
 const catalog=useStoreResource(objectivesStore,userId);
 const [repairError,setRepairError]=useState(null);
 const repairs=useMemo(()=>recoverQuizHistory(entries,history.data?.evidenceJournal,{blockId,lectures:lectures.data||[],objectives:selectBlockObjectives(catalog.data||{},blockId),ratings:quality.data?.ratings||{}}),[entries,history.data,blockId,lectures.data,catalog.data,quality.data]);
 useEffect(()=>{if(!userId||history.loading||lectures.loading||catalog.loading||quality.loading||history.error||lectures.error||catalog.error||quality.error||!repairs.length)return;let active=true;evidence.recordEvidenceBatchAwait(userId,repairs).then(()=>{if(active)setRepairError(null);}).catch(error=>{if(active)setRepairError(error);});return()=>{active=false;};},[userId,repairs,history.loading,lectures.loading,catalog.loading,quality.loading,history.error,lectures.error,catalog.error,quality.error]);
 const result=useMemo(()=>practiceAnswerHistory(entries,history.data||{},blockId,(lectures.data||[]).filter(l=>l.blockId===blockId).map(l=>l.id),quality.data?.ratings||{}),[entries,history.data,blockId,lectures.data,quality.data]);
 return {...result,loading:calibrationResource.loading||history.loading||lectures.loading||quality.loading,error:calibrationResource.error||history.error||lectures.error||quality.error||repairError};
}
