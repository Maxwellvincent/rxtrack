import {useMemo} from 'react';
import * as relationships from '../stores/sourceRelationships.js';
import {useStoreResource} from '../shell/hooks/useStoreResource.js';
/** Only after reveal; absent exact reviewed connection IDs, show no inferred lesson. */
export function ConnectionFeedback({question,userId,lectureId,blockId}){
 if(!question?.sourceRelationshipIds?.length)return null;
 return <LinkedFeedback question={question} userId={userId} lectureId={question.lectureId||lectureId} blockId={question.blockId||blockId}/>;
}
function LinkedFeedback({question,userId,lectureId,blockId}){
 const adapter=useMemo(()=>({read:id=>relationships.read(id,lectureId),isHydrated:id=>relationships.isHydrated(id,lectureId),readError:id=>relationships.readError(id,lectureId),subscribe:callback=>relationships.subscribe(lectureId,callback)}),[lectureId]);
 const resource=useStoreResource(adapter,userId);
 const rows=Object.values(resource.data?.relationships||{}).filter(row=>question.sourceRelationshipIds.includes(row.id)&&question.qualityAudit?.relationshipIds?.includes(row.id)&&row.blockId===blockId&&row.lectureId===lectureId&&question.objectiveIds?.includes(row.objectiveId)&&row.sourceVersion===question.relationshipSourceVersion&&row.learning?.audit?.status==='approved');
 if(!rows.length)return null;
 return <details className="my-3 rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer font-semibold text-accent">Understand the connection this tested</summary>
  {rows.map(row=><div key={row.id} className="mt-3"><p className="font-semibold">{row.label}</p><p className="mt-1">{row.learning.explanation}</p><p className="mt-2 text-text-2"><strong>Check your understanding:</strong> {row.learning.checkPrompt}</p></div>)}
  <p className="mt-2 text-xs text-text-3">Your next fresh application should test this connection with different findings. Reading the explanation does not count as an independent success.</p>
 </details>;
}
