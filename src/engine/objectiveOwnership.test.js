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
