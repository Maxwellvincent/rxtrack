import { expect, it } from "vitest";
import { canonicalObjectiveIds, objectiveCoverage } from "./objectiveLinks.js";
import { backfillTopicsFromAtoms, buildAtomQuestionsPrompt } from "./mcq.js";
const objectives=[{id:"o1",code:"SOM.1",text:"Compare mechanisms"},{id:"o2",text:"Explain development"}];
it("normalizes codes, removes invalid IDs and exposes uncovered objectives",()=>{
 expect(canonicalObjectiveIds(["SOM.1","o1","bad"],objectives)).toEqual(["o1"]);
 expect(objectiveCoverage([{objectiveIds:["SOM.1"]},{objectiveIds:["bad"]}],objectives)).toMatchObject({linkedAtoms:1,unlinkedAtoms:1,uncovered:[{id:"o2"}]});
});
it("keeps the primary returned objective instead of overwriting it with every atom tag",()=>{
 const q=backfillTopicsFromAtoms([{objectiveIds:["o2"]}],[{term:"Term",objectiveIds:["o1","o2"]}],objectives)[0];
 expect(q.objectiveIds).toEqual(["o2"]);
 expect(backfillTopicsFromAtoms([{objectiveIds:["invented"]}],[{term:"Term"}],objectives)[0].objectiveIds).toEqual([]);
});
it("includes actual objectives even without school examples",()=>{
 const prompt=buildAtomQuestionsPrompt({atoms:[{term:"Term",content:"Fact"}],objectives});
 expect(prompt).toContain("[o1] SOM.1 Compare mechanisms"); expect(prompt).toContain("one primary objective");
});
