import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({evidence:{evidenceJournal:[{questionKey:'q',correct:true,objectiveIds:['o'],at:1}]},quality:{ratings:{}}}));
vi.mock('./cloudBase.js',()=>({readCloud:(_u,key,fallback)=>key==='rxt-learner-evidence-v1'?state.evidence:key==='rxt-question-ratings-v1'?state.quality:fallback,subscribeToCloudStore:()=>()=>{},isHydrated:()=>true,readError:()=>null,writeCloud:vi.fn(),writeCloudAwait:vi.fn()}));
import {read} from './learnerEvidence.js';
it('reuses an unchanged account projection and invalidates it for evidence or quality changes',()=>{
 const first=read('u');expect(read('u')).toBe(first);expect(first.objectives.o.attempts).toBe(1);
 state.quality={ratings:{bad:{evidenceKey:'q',sourceIssue:'incorrect-key'}}};const excluded=read('u');expect(excluded).not.toBe(first);expect(excluded.objectives.o.attempts).toBe(0);
 state.evidence={evidenceJournal:[]};expect(read('u')).not.toBe(excluded);
});
