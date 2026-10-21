import { it, expect } from "vitest";
import { lectureSourceObjectives, repairSourceObjectiveLinks } from "./sourceObjectiveScope.js";
const lecture = { id: "olfaction", blockId: "NB", lectureType: "DLA", lectureNumber: 4 };
const text = "Chemical Senses DLA: Olfaction\n\fObjectives\nA student should be able to:\nSOM.MK.I.BPM2.1.NB.1.NSCI.0266 Describe different smell qualities and explain the functional anatomy of the olfactory system\nSOM.MK.I.BPM2.1.NB.1.NSCI.0267 Describe the olfactory pathways and their cortical areas\fOlfactory stimuli\nOther slide text";
it("recognizes a two-objective olfaction page and repairs foreign thyroid links without deleting evidence", () => {
 const source = lectureSourceObjectives(text, lecture, "NB"); expect(source.map(row => row.code.slice(-4))).toEqual(["0266", "0267"]);
 const original = [{ id: "thyroid", objective: "Describe thyroid gland development", linkedLecId: lecture.id, attempts: 7, personalNotes: "keep" }, { id: "existing-olfaction", code: source[0].code, linkedLecId: "wrong", attempts: 3 }];
 const repaired = repairSourceObjectiveLinks(original, lecture, source);
 expect(repaired.find(row => row.id === "thyroid")).toMatchObject({ linkedLecId: null, attempts: 7, personalNotes: "keep" });
 expect(repaired.find(row => row.id === "existing-olfaction")).toMatchObject({ linkedLecId: lecture.id, attempts: 3 });
 expect(repaired.filter(row => row.linkedLecId === lecture.id)).toHaveLength(2);
 expect(repairSourceObjectiveLinks(repaired, lecture, source)).toBe(repaired);
});
it("does not treat inline slide codes or uncoded keywords as a complete objective table", () => {
 expect(lectureSourceObjectives(text.replace("\fObjectives\n", "\fTopics\n"), lecture, "NB")).toEqual([]);
 expect(repairSourceObjectiveLinks([{ id: "keep" }], lecture, [])).toEqual([{ id: "keep" }]);
});
it("preserves manual links and uses stable IDs for newly recovered source objectives", () => {
 const source = lectureSourceObjectives(text, lecture, "NB");
 expect(lectureSourceObjectives(text, lecture, "NB").map(row => row.id)).toEqual(source.map(row => row.id));
 expect(repairSourceObjectiveLinks([{ id: "manual", manuallyAligned: true, linkedLecId: lecture.id }], lecture, source)[0].linkedLecId).toBe(lecture.id);
});
it("quarantines reused codes with unrelated wording and recovers the actual slide objective", () => {
 const code="SOM.MKII.BPM2.1.NB.1.ANAT.0002";
 const skull={id:"skull",blockId:"NB"};
 const original=[{id:"wrong",code,linkedLecId:"skull",objective:"Briefly describe the process from fertilization to the formation of the blastocyst, paying attention to location and timeframe",attempts:4,personalNotes:"Preserve"}];
 const source=[{id:"source:skull:"+code,code,linkedLecId:"skull",objective:"Identify the bones that constitute the viscerocranium of the skull and the foramina found in this part of the skull"}];
 const repaired=repairSourceObjectiveLinks(original,skull,source);
 expect(repaired[0]).toMatchObject({linkedLecId:null,attempts:4,personalNotes:"Preserve",lectureLinkRepair:{reason:"source-code-wording-conflict"}});
 expect(repaired.filter(row=>row.linkedLecId==="skull")).toEqual(source);
 expect(repairSourceObjectiveLinks(repaired,skull,source)).toBe(repaired);
});
