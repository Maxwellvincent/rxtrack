import {it,expect,vi,beforeEach} from 'vitest';
const state=vi.hoisted(()=>({value:null}));
vi.mock('./cloudBase.js',()=>({readCloud:()=>state.value,updateCloudAwait:async(uid,key,update)=>{if(!uid)throw new Error('Sign in');state.value=update(structuredClone(state.value));return state.value;},subscribeToCloudStore:()=>()=>{},isHydrated:()=>true,readError:()=>null}));
import {freezeSnapshot,saveActual} from './readinessValidation.js';
beforeEach(()=>{state.value=null;});
it('locks the forecast, appends the actual result and rejects replacement or hindsight',async()=>{
 const createdAt=Date.now()-10000;
 await freezeSnapshot('u',{name:'School test',lectureIds:['l'],testAt:Date.now()+10000,estimatePercent:85,goal:80,createdAt});
 const saved=structuredClone(state.value.snapshots[0]);
 expect(saved.createdAt).toBeGreaterThan(createdAt);
 state.value.snapshots[0].createdAt=Date.now()-5000;
 await saveActual('u',saved.id,{correct:40,total:50,takenAt:Date.now()-1000});
 expect(state.value.snapshots[0].estimatePercent).toBe(85);
 expect(state.value.snapshots[0].actual.errorPoints).toBe(-5);
 await expect(saveActual('u',saved.id,{correct:50,total:50,takenAt:Date.now()-1000})).rejects.toThrow(/already/);
 await expect(freezeSnapshot('u',{name:'Late',lectureIds:['l'],testAt:Date.now()-1000})).rejects.toThrow(/future/);
 await expect(freezeSnapshot('u',{name:'Invalid date',lectureIds:['l'],testAt:NaN})).rejects.toThrow();
});
