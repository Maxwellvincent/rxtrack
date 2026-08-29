import { objectiveCoverage } from "../../../engine/objectiveLinks.js";
import { alignSchoolQuestions } from "../../../engine/schoolAlignment.js";

export function ObjectiveCoverage({ atoms = [], objectives = [], examples = [] }) {
  const coverage = objectiveCoverage(atoms, objectives);
  const links = alignSchoolQuestions(examples, objectives);
  const supported = links.filter(q => q.links.length);
  const coded = supported.filter(q => q.links.some(l => l.basis === "school-code"));
  return <details className="my-4 w-full max-w-3xl rounded-lg border border-border bg-bg-elevated p-3">
    <summary className="cursor-pointer py-2 font-semibold">Objective coverage · {objectives.length - coverage.uncovered.length}/{objectives.length} linked to atoms</summary>
    <p className="my-2 text-sm text-text-2">{coverage.linkedAtoms} linked atoms · {coverage.unlinkedAtoms} without a valid objective link. These are content links, not proof of mastery. Use “Tag atoms to objectives” to reconcile stored atoms; inspect the matches before treating them as coverage.</p>
    {!objectives.length && <p className="text-sm">No lecture objectives loaded. Recover or import the original objectives before relying on objective-specific practice.</p>}
    <ul className="space-y-2 text-sm">{objectives.map(o => <li key={o.id} className="border-t border-border pt-2">
      <strong>{o.code || "Objective"}</strong> · {coverage.counts[o.id] || 0} linked atoms
      <p>{o.objective || o.text}</p>
      {!coverage.counts[o.id] && <span className="text-status-purple">◇ Coverage gap — no linked atoms yet</span>}
    </li>)}</ul>
    <details className="mt-3 border-t border-border pt-2 text-sm">
      <summary>School-question comparison · {coded.length} code-linked / {supported.length - coded.length} candidate matches</summary>
      <p className="my-2">From {examples.length} available examples. Exact school codes are source annotations; wording matches are candidates, not verified conceptual equivalence. Unmatched objectives still matter. Neither IMCQ difficulty nor a practice score predicts your exam grade.</p>
      {supported.slice(0,20).map(({question:q,links:ls},i)=><div key={i} className="my-2 border-t border-border pt-2">
        <strong>{q.sourceFile || q.sourceKind || "School question"} · {q.num || q.id || i+1}</strong>
        {ls.map((l,j)=><p key={j}>{l.basis === "school-code" ? "School code" : "Candidate overlap"}: {l.targetText} · {l.evidence.join(", ")}</p>)}
      </div>)}
      {supported.length > 20 && <p>Showing the first 20 matches.</p>}
    </details>
  </details>;
}
