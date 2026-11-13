import {useReducer,useCallback} from 'react';
const PANELS=new Set(['practice','learn','progress','sources']);
export function lectureWorkspaceReducer(state,name){
 if(!PANELS.has(name)||state.active===name)return state;
 return {active:name,visited:state.visited.includes(name)?state.visited:[...state.visited,name]};
}
export function useLectureWorkspace(){
 const [state,dispatch]=useReducer(lectureWorkspaceReducer,{active:'practice',visited:['practice']});
 const activate=useCallback(name=>dispatch(name),[]);
 return [state.active,activate,state.visited];
}
