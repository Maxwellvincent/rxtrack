import {useEffect,useSyncExternalStore} from 'react';
const listeners=new Set();let timer=null,snapshot=Date.now();
const getSnapshot=()=>snapshot;
function refresh(){const next=Date.now();if(next===snapshot)return;snapshot=next;listeners.forEach(listener=>listener());}
function subscribe(listener){
 listeners.add(listener);
 if(listeners.size===1){timer=setInterval(refresh,60000);globalThis.window?.addEventListener('focus',refresh);refresh();}
 return ()=>{listeners.delete(listener);if(!listeners.size){clearInterval(timer);timer=null;globalThis.window?.removeEventListener('focus',refresh);}};
}
/** One shared minute clock; new evidence and focus refresh it without polling data. */
export function usePlanningClock(revision){
 useEffect(()=>refresh(),[revision]);
 return useSyncExternalStore(subscribe,getSnapshot,()=>0);
}
