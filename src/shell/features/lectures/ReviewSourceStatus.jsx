import {useMemo} from 'react';
import {useStoreResource} from '../../hooks/useStoreResource.js';
import * as library from '../../../stores/reviewLibrary.js';
export function ReviewSourceStatus({userId,blockId}){
 const store=useMemo(()=>({read:uid=>library.read(uid,blockId),subscribe:cb=>library.subscribe(blockId,cb)}),[blockId]);
 const resource=useStoreResource(store,userId),manifest=resource.data;
 if(!manifest?.ready)return null;
 return <p className="my-3 text-sm text-text-2" role="status">NB2 review sources synced to your account · {manifest.packs.length} sources · shared by lecture quizzes, exams, guided cases and recognition practice.</p>;
}
