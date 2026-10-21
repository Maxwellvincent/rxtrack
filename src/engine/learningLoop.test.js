import {expect,it} from "vitest";
import {learningFocus,questionLearningContext,objectiveLearningReport,shortRetestPlan,latestLearningRecords} from "./learningLoop.js";
const objectives=Array.from({length:4},(_,i)=>({id:`o${i}`,objective:`Explain source relationship ${i}`}));
const evidence={objectives:Object.fromEntries(objectives.map(o=>[o.id,{attempts:3,correct:3,recent:[true,true,true],sessions:["first"],taskTypes:{recognition:1,mechanism:2}}]))};
it("all correct in one session counts as practiced and offers a four-question fresh retest",()=>{
 const records=objectives.map(o=>({objectiveIds:[o.id],correct:true}));
 expect(objectiveLearningReport(objectives,evidence,records).every(row=>row.label==="Ready for retest")).toBe(true);
 expect(shortRetestPlan(objectives,evidence,records)).toMatchObject({count:4,objectives});
 const ready={objectives:Object.fromEntries(Object.entries(evidence.objectives).map(([id,value])=>[id,{...value,sessions:["first","second"]}]))};
 expect(objectiveLearningReport(objectives,ready,records).every(row=>row.label==="Consistently demonstrated")).toBe(true);
 expect(shortRetestPlan(objectives,ready,records).count).toBe(0);
});
it("limits a follow-up to six practiced unresolved objectives and prioritizes current misses",()=>{
 const extra=Array.from({length:10},(_,i)=>({id:`o${i}`}));
 const state={objectives:Object.fromEntries(extra.map(o=>[o.id,{attempts:1,correct:1,recent:[true]}]))};
 const records=extra.map(o=>({objectiveIds:[o.id],correct:o.id!=="o9"}));
 const plan=shortRetestPlan(extra,state,records);
 expect(plan.count).toBe(6);expect(plan.objectives).toHaveLength(6);expect(plan.objectives[0].id).toBe("o9");
 expect(shortRetestPlan(extra,{},[]).count).toBe(0);
});
it("targets observed choice contrasts and explicit notes only within the requested curriculum",()=>{
 const context=questionLearningContext({topic:"Nerve exits",choices:{A:"Foramen ovale",B:"Foramen rotundum"},correct:"B"},"A");
 const state={learningJournal:[{objectiveIds:["o0"],blockId:"NB",questionKey:"q",correct:false,learningContext:context},{objectiveIds:["other"],correct:false,learningContext:{selected:"Private unrelated",keyed:"other"}}],learningNotes:[{objectiveIds:["o0"],note:"I confuse V2 and V3"}]};
 const focus=learningFocus({objectives,evidence:state,blockId:"NB"});
 expect(focus).toContain("Foramen ovale");expect(focus).toContain("I confuse V2 and V3");expect(focus).not.toContain("Private unrelated");
 expect(focus).toContain("not medical authority");
 expect(learningFocus({objectives,evidence:{learningJournal:[],evidenceJournal:state.learningJournal}})).toBe("");
});
it("restores the latest practice session after leaving the lecture, without duplicate answer saves",()=>{
 const events=[{lectureId:"l",blockId:"NB",sessionKey:"old",questionKey:"a",at:1},{lectureId:"l",blockId:"NB",sessionKey:"new",questionKey:"b",at:2},{lectureId:"l",blockId:"NB",sessionKey:"new",questionKey:"b",at:3},{lectureId:"l",blockId:"DM",sessionKey:"other",at:4}];
 expect(latestLearningRecords({learningJournal:events},"l","NB")).toHaveLength(1);
 expect(latestLearningRecords({learningJournal:events},"l","NB")[0].sessionKey).toBe("new");
});
