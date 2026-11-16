import { useEffect } from 'react';
import { useStoreResource } from './useStoreResource.js';
import * as evidenceStore from '../../stores/learnerEvidence.js';
import * as weakStore from '../../stores/weakConcepts.js';
import { reconcileWeakConceptRecovery } from '../../engine/weakConceptRecovery.js';

export function useRecoverySync(userId) {
  const evidence = useStoreResource(evidenceStore,userId);
  const weak = useStoreResource(weakStore,userId);
  useEffect(()=>{
    if(evidence.loading || weak.loading || evidence.error || weak.error) return;
    const events=evidence.data?.learningJournal || [];
    if(reconcileWeakConceptRecovery(weak.data,events)===weak.data)return;
    weakStore.reconcileEvidenceAwait(userId,events).catch(error=>console.warn('Recovery sync failed',error));
  },[userId,evidence.data,evidence.loading,evidence.error,weak.data,weak.loading,weak.error]);
}
