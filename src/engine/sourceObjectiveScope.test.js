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

it("keeps every wrapped synaptic objective paired with its own code",()=>{
 const lecture={id:"synapse",blockId:"NB",lectureType:"LEC",lectureNumber:8};
 const source=lectureSourceObjectives("Lecture Objectives\nSOM.MK.I.BPM2.1.NB.1. Describe the morphological and functional characteristics of\nNSCI.0092             the various types of synapses\nSOM.MK.I.BPM2.1.NB.1.\nNSCI.0093\n                      Contrast ionotropic and metabotropic receptors\nSOM.MK.I.BPM2.1.NB.1.\nNSCI.0094\n                      List five steps in the life cycles of small-molecule transmitters\nSOM.MK.I.BPM2.1.NB.1.\nNSCI.0095\n                      List five steps in the life cycles of neuroactive peptides\n                        List five events that underlie the interval between a\nSOM.MK.I.BPM2.1.NB.1.\nNSCI.0096\n                      presynaptic impulse and postsynaptic responses to\n                        neurotransmitter\nSOM.MK.I.BPM2.1.NB.1.\nNSCI.0097\n                      Describe quantal release of neurotransmitters\nSOM.MK.I.BPM2.1.NB.1. Explain the effects of select substances on release of\nNSCI.0098             transmitters\nSOM.MK.I.BPM2.1.NB.1.\nNSCI.0099\n                      Explain decrement and summation of postsynaptic potentials\nSOM.MK.I.BPM2.1.NB.1. Explain mechanisms for destruction/removal of\nNSCI.0100             neurotransmitter from the synapse\n",lecture,"NB");
 expect(source.map(o=>o.code.slice(-4))).toEqual(["0092","0093","0094","0095","0096","0097","0098","0099","0100"]);
 expect(source[1].objective).toBe("Contrast ionotropic and metabotropic receptors");
 expect(source[2].objective).toContain("small-molecule transmitters");
 expect(source[3].objective).toBe("List five steps in the life cycles of neuroactive peptides");
 expect(source[4].objective).toMatch(/^List five events/);
 const existing=source.map((o,i)=>({...o,id:"original"+i,linkedLecId:null,attempts:2}));
 const restored=repairSourceObjectiveLinks(existing,lecture,source);
 expect(restored).toHaveLength(9);expect(restored.every(o=>o.linkedLecId===lecture.id && o.attempts===2)).toBe(true);
});
it("preserves a practiced school identity when only the Bloom code differs from the exact slide objective",()=>{
 const lecture={id:"synapse",blockId:"NB"},objective="Explain the effects of select substances on release of transmitters";
 const row={id:"practiced",code:"SOM.MK.IV.BPM2.1.NB.1.NSCI.0098",objective,linkedLecId:null,lectureLinkRepair:{previousLectureId:"synapse",reason:"explicit-source-objective-mismatch"},attempts:4};
 const source={id:"source",code:"SOM.MK.I.BPM2.1.NB.1.NSCI.0098",objective,linkedLecId:"synapse"};
 const restored=repairSourceObjectiveLinks([row],lecture,[source]);
 expect(restored).toHaveLength(1);expect(restored[0]).toMatchObject({id:"practiced",code:row.code,linkedLecId:"synapse",attempts:4});
 expect(repairSourceObjectiveLinks([{...row,objective:"Describe quantal release of neurotransmitters"}],lecture,[source])[0].linkedLecId).toBe(null);
});

it("retains both eye objective pages including Give, State and spaced curriculum codes",()=>{
 const lecture={id:"eye",blockId:"NB",lectureNumber:20,lectureType:"LEC"};
 const source=lectureSourceObjectives("Objectives \nBPM2 | NB | Lecture 20 | Histology of the Eye \nSOM.MK.I.BPM 2.4 .NB. 1 .HCB. 1330   List the 3 layers of the walls of the eyeball. \nSOM.MK.I.BPM2.4.NB.1.HCB.1331   Differentiate between the anterior and posterior chambers of the eye \nbased on location. \nSOM.MK.I.BPM2.4.NB.1.HCB.1332   Give the function(s) of the sclera of the corneoscleral coat. \nSOM.MK.I.BPM2.4.NB.1.HCB.1333   Describe the microscopic structures of the sclera of the corneoscleral \ncoat. \nSOM.MK.I.BPM2.4.NB.1.HCB.1334   Give the function(s) of the cornea of the corneoscleral coat. \nSOM.MK.I.BPM2.4.NB.1.HCB.1335   Describe the microscopic structures of the cornea of the \ncorneoscleral coat. \nSOM.MK.I.BPM2.4.NB.1.HCB.1336   Give the function(s) of the choroid of the uveal tract. \nSOM.MK.I.BPM2.4.NB.1.HCB.1337   Describe the microscopic structure of the choroid of the uveal tract. \nSOM.MK.I.BPM2.4.NB.1.HCB.1338   Describe the functional significance of   choriocapillary   layer of \nchoroid. \nSOM.MK.I.BPM2.4.NB.1.HCB.1339   Give the function(s) of the ciliary body of the uveal tract. \nSOM.MK.I.BPM2.4.NB.1.HCB.1340   Describe the microscopic structure of the ciliary body of the uveal \ntract. \nSOM.MK.I.BPM2.4.NB.1.HCB.1341   Give the function(s) of the iris of the uveal tract. \nSOM.MK.I.BPM2.4.NB.1.HCB.1342   Describe the microscopic structure of the iris of the uveal tract. \nSOM.MK.I.BPM2.4.NB.1.HCB.1343   Describe the synthesis of aqueous humor. \nSOM.MK.I.BPM2.4.NB.1.HCB.1344   Describe the pathway for the drainage of aqueous humor \nSOM.MK.I.BPM2.4.NB.1.HCB.1345   Describe the blood supply of the retina.\nYour Objectives will show here! \nObjectives \nBPM2 | NB | Lecture 20 | Histology of the Eye \nSOM.MK.I.BPM2.4.NB.1.HCB.1346   Describe the microscopic structure of the retina. \nSOM.MK.I.BPM2.4.NB.1.HCB.1347   Describe the microscopic structure of optic disc. \nSOM.MK.I.BPM2.4.NB.1.HCB.1348   Describe the microscopic structures of the fovea centralis. \nSOM.MK.I.BPM2.4.NB.1.HCB.1349   State the function of the lens. \nSOM.MK.I.BPM2.4.NB.1.HCB.1350   Describe the microscopic structure of the lens. \nSOM.MK.I.BPM2.4.NB.1.HCB.1351   Give the function of the vitreous body. \nSOM.MK.I.BPM2.4.NB.1.HCB.1352   Describe the microscopic structure of vitreous body. \nSOM.MK.I.BPM2.4.NB.1.HCB.1353   Differentiate between the glands of the eyelids based on their \nmicroscopic structure, location and clinical significance. \nSOM.MK.I.BPM2.4.NB.1.HCB.1354   Describe the microscopic structure of the conjunctiva. \nSOM.MK.I.BPM2.4.NB.1.HCB.1355   Describe the structural changes in the retina in retinal detachment. \nSOM.MK.I.BPM2.4.NB.1.HCB.1356   Explain the effect of multiple sclerosis on the optic nerve. \nSOM.MK.I.BPM2.4.NB.1.HCB.1357   Explain the clinical significance of corneal transplant. \nSOM.MK.I.BPM2.4.NB.1.HCB.1358   Describe the changes in the lens in cataract. \nSOM.MK.I.BPM2.4.NB.1.HCB.1359   Describe the changes in the eye that result in glaucoma. \n",lecture,"NB");
 expect(source.map(o=>o.code.slice(-4))).toEqual(Array.from({length:30},(_,i)=>String(1330+i)));
 expect(source.find(o=>o.code.endsWith("1332")).objective).toMatch(/^Give the function/);
 expect(source.find(o=>o.code.endsWith("1349")).objective).toBe("State the function of the lens.");
 expect(source.some(o=>o.code.endsWith("1360"))).toBe(false);
});
it("includes later objective pages across PDF page boundaries",()=>{
 const source=lectureSourceObjectives("Objectives\nSOM.MK.I.BPM2.1.NB.1.NSCI.0001 Give the first function.\fSlide content\fObjectives\nSOM.MK.I.BPM2.1.NB.1.NSCI.0002 Correlate the second relationship.\fBody",lecture,"NB");
 expect(source.map(o=>o.code.slice(-4))).toEqual(["0001","0002"]);
});
it("updates the stale lecture number when a source-backed objective moves to its correct lecture",()=>{
 const ear={id:"ear",lectureNumber:22},code="SOM.MK.I.BPM2.4.NB.1.HCB.1381",objective="Describe the histological structure of the cochlear hair cells";
 const row={id:"practiced",code,objective,linkedLecId:"eye",lectureNumber:20,attempts:4};
 const result=repairSourceObjectiveLinks([row],ear,[{code,objective}]);
 expect(result[0]).toMatchObject({id:"practiced",linkedLecId:"ear",lectureNumber:22,attempts:4});
});
