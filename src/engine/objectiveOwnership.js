import { lectureSourceObjectives } from "./sourceObjectiveScope.js";

const normalize = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Explicit verdict and optional clause evidence, not a keyword-based remapper. */
export function objectiveAlignmentIssue(review, question, cfg = {}) {
  if (!(cfg.objectives || []).length) return null;
  if (review?.objectiveAligned === false) return "objective_mismatch";
  if (cfg.requireReasoningAudit && review?.approved === true && review.objectiveAligned !== true) return "unverified_objective_alignment";
  const claim = review?.objectiveAlignment;
  if (!claim) return null; // Older reviewers retain their explicit aligned verdict.
  const ids = question.objectiveIds || [];
  const objective = ids.length === 1 && cfg.objectives.find(row => String(row.id || row.code) === String(ids[0]));
  const target = normalize(objective?.objective || objective?.text);
  const clause = normalize(claim.objectiveClause);
  if (!objective || String(claim.objectiveId) !== String(ids[0]) || !target || clause.length < Math.min(16, target.length)
    || !target.includes(clause) || !String(claim.testedRelationship || "").trim()) return "unverified_objective_alignment";
  return null;
}

export function objectiveOwnershipPrompt(cfg = {}) {
  if (!(cfg.objectives || []).length) return "";
  const source = lectureSourceObjectives(cfg.lectureText || "", { id: "review-scope" }, null);
  return `\nOBJECTIVE OWNERSHIP CHECK: Identify the actual relationship required to answer the final question, then quote the exact clause of its assigned objective that this tests. Shared lecture vocabulary, source citations and a matching school template do not establish objective ownership. Compare neighboring source objectives below, including ones outside this quiz allocation. If the item chiefly tests a neighboring objective, reject as objective_mismatch; do not attach the allocated ID merely to fill its quota. Do not silently remap or award coverage to another objective. Source objectives define scope, not factual evidence. During independent review, return objectiveAligned plus objectiveAlignment: {"objectiveId":"the question's assigned ID","objectiveClause":"exact contiguous clause from that assigned objective","testedRelationship":"specific task the learner must perform"}. A false alignment verdict is blocking even if the medical key is correct.\nNEIGHBORING SOURCE OBJECTIVES (scope only):\n${JSON.stringify(source.slice(0, 60).map(row => ({ code: row.code, text: row.objective || row.text })))}\n`;
}
