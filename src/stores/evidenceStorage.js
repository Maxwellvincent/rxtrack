/** These aggregates are rebuilt by learnerEvidence.read from baseline + journal.
 * Do not store a second copy as history approaches Firestore's document limit. */
export function evidenceStorageValue(key,value){
 if(key!=='rxt-learner-evidence-v1'||!value?.evidenceBaseline||!Array.isArray(value.evidenceJournal))return value;
 const next={...value};
 for(const field of ['objectives','atoms','lectures','sources','taskTypes','orderLevels','total','correct'])delete next[field];
 return next;
}
