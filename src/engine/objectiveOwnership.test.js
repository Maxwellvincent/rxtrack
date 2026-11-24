import { expect, it } from "vitest";
import { objectiveAlignmentIssue, objectiveOwnershipPrompt } from "./objectiveOwnership.js";

const objective = { id: "receptors", code: "SOM.MK.I.BPM2.1.NB.1.NSCI.0114", objective: "Describe the morphology and functional characteristics of skin receptors" };
const cfg = { objectives: [objective], requireReasoningAudit: true };
const question = { objectiveIds: [objective.id] };

it("does not let medical approval override a negative or missing objective verdict", () => {
  expect(objectiveAlignmentIssue({ approved: true, objectiveAligned: false }, question, cfg)).toBe("objective_mismatch");
  expect(objectiveAlignmentIssue({ approved: true }, question, cfg)).toBe("unverified_objective_alignment");
  expect(objectiveAlignmentIssue({ approved: true, objectiveAligned: true }, question, cfg)).toBeNull();
});

it("checks a reported clause belongs to the assigned objective rather than its neighbor", () => {
  const review = { approved: true, objectiveAligned: true, objectiveAlignment: { objectiveId: objective.id, objectiveClause: "functional characteristics of skin receptors", testedRelationship: "Use receptor adaptation to interpret the recording" } };
  expect(objectiveAlignmentIssue(review, question, cfg)).toBeNull();
  expect(objectiveAlignmentIssue({ ...review, objectiveAlignment: { ...review.objectiveAlignment, objectiveClause: "Classify afferent fibers by conduction velocity" } }, question, cfg)).toBe("unverified_objective_alignment");
  expect(objectiveAlignmentIssue({ ...review, objectiveAlignment: { ...review.objectiveAlignment, objectiveId: "neighbor" } }, question, cfg)).toBe("unverified_objective_alignment");
});

it("shows unselected neighboring source objectives without promoting them to factual evidence", () => {
  const prompt = objectiveOwnershipPrompt({ ...cfg, lectureText: `Learning Objectives\n${objective.code} ${objective.objective}\nSOM.MK.I.BPM2.1.NB.1.NSCI.0115 Classify afferent fibers according to diameter and conduction velocity\fLecture body` });
  expect(prompt).toContain("NSCI.0115");
  expect(prompt).toContain("conduction velocity");
  expect(prompt).toContain("do not attach the allocated ID");
  expect(prompt).toContain("not factual evidence");
  expect(objectiveOwnershipPrompt({})).toBe("");
});

it('requires a best-source choice and blocks a more specific neighboring owner on strict launches',()=>{
 const strict={...cfg,requireDiscriminationAudit:true,lectureText:`Learning Objectives\n${objective.code} ${objective.objective}\nSOM.MK.I.BPM2.1.NB.1.NSCI.0115 Classify afferent fibers according to diameter and conduction velocity\fLecture body`};
 const claim={objectiveId:objective.id,objectiveClause:'functional characteristics of skin receptors',testedRelationship:'Interpret a recorded response'};
 const review={approved:true,objectiveAligned:true,objectiveAlignment:claim};
 expect(objectiveAlignmentIssue(review,question,strict)).toBe('unverified_objective_alignment');
 expect(objectiveAlignmentIssue({...review,objectiveAlignment:{...claim,bestSourceObjectiveCode:'SOM.MK.I.BPM2.1.NB.1.NSCI.0115',whyAssignedOverNeighbor:'The endpoint asks fiber size and conduction velocity.'}},question,strict)).toBe('objective_mismatch');
 expect(objectiveAlignmentIssue({...review,objectiveAlignment:{...claim,bestSourceObjectiveCode:objective.code,whyAssignedOverNeighbor:'The endpoint compares receptor adaptation, not axonal conduction.'}},question,strict)).toBeNull();
});

it("re-files a question the reviewer assigns to another objective in the same quiz instead of rejecting it", async () => {
  const { refileToReviewedObjective } = await import("./objectiveOwnership.js");
  const criteria = { id: "crit", code: "SOM.MK.I.BPM2.4.NB.4.BEHS.0067", objective: "Apply the essential diagnostic criteria for anxiety disorders, including any subtypes" };
  const differentiate = { id: "diff", code: "SOM.MK.I.BPM2.4.NB.4.BEHS.0188", objective: "Clinically differentiate the anxiety disorders from other psychiatric disorders" };
  const outside = "SOM.MK.I.BPM2.4.NB.4.BEHS.0999";
  const strict = { objectives: [criteria, differentiate], requireReasoningAudit: true, requireDiscriminationAudit: true,
    lectureText: `Learning Objectives\n${criteria.code} ${criteria.objective}\n${differentiate.code} ${differentiate.objective}\n${outside} Describe something else entirely` };
  const drafted = { objectiveIds: ["crit"] };
  const review = { approved: true, objectiveAligned: true, objectiveAlignment: { objectiveId: "crit", objectiveClause: "essential diagnostic criteria for anxiety disorders", testedRelationship: "Distinguish GAD from MDD", bestSourceObjectiveCode: differentiate.code, whyAssignedOverNeighbor: "The task is to differentiate anxiety from depression." } };
  expect(objectiveAlignmentIssue(review, drafted, strict)).toBe("objective_mismatch");
  const refiled = refileToReviewedObjective(review, drafted, strict);
  expect(refiled.question.objectiveIds).toEqual(["diff"]);
  expect(refiled.question.refiledFromObjectiveId).toBe("crit");
  expect(objectiveAlignmentIssue(refiled.review, refiled.question, strict)).toBeNull();
  // A neighbor outside this quiz's objectives is still a genuine mismatch.
  const away = { ...review, objectiveAlignment: { ...review.objectiveAlignment, bestSourceObjectiveCode: outside } };
  expect(refileToReviewedObjective(away, drafted, strict).question).toBe(drafted);
  expect(objectiveAlignmentIssue(away, drafted, strict)).toBe("objective_mismatch");
  // An explicit "not aligned" verdict naming a quiz objective is also re-filed.
  const explicit = { ...review, objectiveAligned: false };
  expect(refileToReviewedObjective(explicit, drafted, strict).question.objectiveIds).toEqual(["diff"]);
});
