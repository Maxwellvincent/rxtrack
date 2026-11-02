/** Notify mounted views only after a saved-session publication succeeds. */
const listeners=new Set();
export function subscribeExamSessionChanges(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function sessionPublicationChanged(current,next){return !!next && (next.progressSavedAt!==current?.progressSavedAt || (next.status!==current?.status && ["submitted","abandoned"].includes(next.status)));}
export function notifyExamSessionChange(change){for(const listener of listeners){try{listener(change);}catch{/* A view refresh cannot turn a successful save into an apparent failure. */}}}
