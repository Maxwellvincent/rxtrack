import { useMemo } from "react";
import { projectedScore } from "./projectedScore.js";
import { withSchoolEmphasis } from "../../../engine/schoolEmphasis.js";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";

/** Estimated exam score against the 80% target, and the objectives that would raise it most. */
export function ProjectedScoreCard({ userId, blockId, lectures = [], objectives = [], evidence = {}, onPractice }) {
  const banks = useQuestionBanks(userId);
  const result = useMemo(() => {
    const lectureIds = new Set(lectures.filter((lecture) => lecture.blockId === blockId).map((lecture) => lecture.id));
    const scoped = objectives.filter((objective) => lectureIds.has(objective.linkedLecId));
    const school = Object.values(banks.data || {}).flat().filter((question) => question?.blockId === blockId);
    return projectedScore(withSchoolEmphasis(scoped, school), evidence);
  }, [banks.data, lectures, objectives, evidence, blockId]);
  if (!result) return null;
  const pct = Math.round(result.score * 100);
  const lectureName = (id) => { const lecture = lectures.find((row) => row.id === id); return lecture ? `${lecture.lectureType || "Lec"} ${lecture.lectureNumber ?? ""}`.trim() : ""; };
  return <section aria-label="Projected score" className="rounded-xl border border-border p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-semibold">Projected ~{pct}% <span className="font-normal text-text-3">· target 80%</span></h3>
      <span className="text-sm font-semibold">{pct >= 80 ? "✓ on target" : `⚠ ${80 - pct} points short`}</span>
    </div>
    <p className="mt-1 text-xs text-text-3">Your own-answer accuracy per objective, weighted by how often school questions test it. Unanswered objectives count as 50%. {result.answered}/{result.objectives} objectives answered{result.coverage < 0.5 ? " — too few to trust this number yet" : ""}. An estimate, not a prediction.</p>
    {result.topGains.length > 0 && <>
      <p className="mt-3 text-sm font-semibold">Fix these first</p>
      <ol className="mt-1 flex flex-col gap-1 text-sm">{result.topGains.map((row) => <li key={row.id} className="flex items-baseline gap-2">
        <span className="shrink-0 text-xs text-text-3">{lectureName(row.lectureId)}</span>
        <span className="min-w-0 flex-1 truncate" title={row.text}>{row.text}</span>
        <span className="shrink-0 text-xs text-text-3">{row.attempts ? `${Math.round(row.p * 100)}%` : "unanswered"}{row.weight > 1 ? ` · tested ×${row.weight - 1}` : ""}</span>
        {onPractice && row.lectureId && <button type="button" className="shrink-0 rounded border border-border px-2 py-0.5 text-xs" onClick={() => onPractice(row)}>Practice</button>}
      </li>)}</ol>
    </>}
  </section>;
}
