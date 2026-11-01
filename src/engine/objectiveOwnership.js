import { lectureSourceObjectives } from "./sourceObjectiveScope.js";

const normalize = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Explicit verdict and optional clause evidence, not a keyword-based remapper. */
export function objectiveAlignmentIssue(review, question, cfg = {}) {
  if (!(cfg.objectives || []).length) return null;
  if (review?.objectiveAligned === false) return "objective_mismatch";
  if (cfg.requireReasoningAudit && review?.approved === true && review.objectiveAligned !== true) return "unverified_objective_alignment";
  const claim = review?.objectiveAlignment;
  // A broad clause alone can conceal ownership by a more specific neighbor.
  // Require an explicit source-inventory choice when that inventory is available.
  if (cfg.requireDiscriminationAudit && review?.approved === true) {
    const source=lectureSourceObjectives(cfg.lectureText || "",{id:"review-scope"},null);
    const assigned=(cfg.objectives || []).find(o=>(question.objectiveIds || []).includes(String(o.id || o.code)));
    const expected=String(assigned?.code || "").replace(/\s/g,"").toUpperCase();
    if(source.length>1 && expected && source.some(o=>String(o.code).toUpperCase()===expected)){
      const chosen=String(claim?.bestSourceObjectiveCode || "").replace(/\s/g,"").toUpperCase();
      if(!chosen || !String(claim?.whyAssignedOverNeighbor || "").trim())return "unverified_objective_alignment";
      if(chosen!==expected)return "objective_mismatch";
    }
  }
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
  return `\nOBJECTIVE OWNERSHIP CHECK: FIRST choose the best-matching source objective from the full neighboring inventory based on the actual final task, independently of the allocated ID. Prefer the objective explicitly naming the tested relationship over a broader clause with shared vocabulary. Only then compare your chosen source objective to the assigned ID and quote the exact clause of its assigned objective that this tests. Shared lecture vocabulary, source citations and a matching school template do not establish objective ownership. Compare neighboring source objectives below, including ones outside this quiz allocation. If the item chiefly tests a neighboring objective, reject as objective_mismatch; do not attach the allocated ID merely to fill its quota. Do not silently remap or award coverage to another objective. Source objectives define scope, not factual evidence. During independent review, return objectiveAligned plus objectiveAlignment: {"objectiveId":"the question's assigned ID","objectiveClause":"exact contiguous clause from that assigned objective","testedRelationship":"specific task the learner must perform","bestSourceObjectiveCode":"exact code of the strongest source objective match","whyAssignedOverNeighbor":"why this task belongs here rather than the closest competing source objective"}. A false alignment verdict is blocking even if the medical key is correct.\nNEIGHBORING SOURCE OBJECTIVES (scope only):\n${JSON.stringify(source.slice(0, 60).map(row => ({ code: row.code, text: row.objective || row.text })))}\n`;
}
