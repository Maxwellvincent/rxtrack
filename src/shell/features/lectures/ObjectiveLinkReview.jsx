import { useMemo, useState } from "react";
import { Button } from "../../../ui/Button.jsx";

function lectureLabel(lecture) {
  return `${lecture?.lectureType || "LEC"} ${lecture?.lectureNumber ?? "—"} — ${lecture?.lectureTitle || lecture?.title || "Untitled lecture"}`;
}

/** Review objective-to-lecture links with exact slide-code evidence where available. */
export function ObjectiveLinkReview({ objectives = [], lectures = [], activeLecture, slideAudit = [], onConfirmLink, savingId = null, disabled = false }) {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState({});
  const auditById = useMemo(() => new Map(slideAudit.map((entry) => [String(entry.objective?.id || ""), entry])), [slideAudit]);
  const reviewRows = useMemo(() => objectives.map((objective) => ({
    objective,
    audit: auditById.get(String(objective?.id || "")) || null,
  })).filter(({ objective, audit }) => showAll
    || objective?.linkedLecId === activeLecture?.id
    || audit?.status === "found"
    || audit?.status === "found-unlocated"), [objectives, auditById, showAll, activeLecture?.id]);
  const candidates = useMemo(() => {
    const map = new Map((lectures || []).filter((lecture) => lecture?.id).map((lecture) => [lecture.id, lecture]));
    if (activeLecture?.id) map.set(activeLecture.id, activeLecture);
    return [...map.values()].sort((a, b) => Number(a.lectureNumber || 0) - Number(b.lectureNumber || 0)
      || String(a.lectureTitle || "").localeCompare(String(b.lectureTitle || "")));
  }, [lectures, activeLecture]);

  return <details className="my-3 rounded-xl border border-border bg-bg-elevated p-3">
    <summary className="cursor-pointer font-semibold">Review objective links · {reviewRows.length} to inspect</summary>
    <p className="mt-2 text-sm text-text-2">Exact SOM-code matches identify source slides when available. A missing match can mean OCR omitted the code, so it is a prompt to review—not proof the link is wrong.</p>
    <button type="button" className="mt-2 min-h-9 text-sm text-accent underline" onClick={(event) => { event.preventDefault(); setShowAll((value) => !value); }}>
      {showAll ? "Show current lecture and source matches" : `Show all ${objectives.length} block objectives`}
    </button>
    <div className="mt-3 max-h-[32rem] space-y-2 overflow-auto">
      {reviewRows.map(({ objective, audit }) => {
        const id = String(objective.id || objective.code || objective.objective || "");
        const targetId = selected[id] ?? objective.linkedLecId ?? "";
        const target = candidates.find((candidate) => candidate.id === targetId);
        const sameLink = targetId && targetId === objective.linkedLecId;
        return <article key={id} className="rounded-lg border border-border p-3">
          <p className="font-medium text-text-1">{objective.objective || objective.text || "Objective text unavailable"}</p>
          <p className="mt-1 text-xs text-text-3">{objective.code || objective.objectiveCode || "No SOM code"} · currently {target ? lectureLabel(target) : "unlinked"}</p>
          {target && (String(objective.lectureNumber ?? "") !== String(target.lectureNumber ?? "")
            || String(objective.lectureType || "LEC") !== String(target.lectureType || "LEC")) && <p className="mt-1 text-xs text-warn">
            Stored objective scope says {objective.lectureType || "LEC"} {objective.lectureNumber ?? "—"}, but the linked lecture is {target.lectureType || "LEC"} {target.lectureNumber ?? "—"}.
          </p>}
          {audit?.status === "found" && <p className="mt-1 text-xs text-good">Code found on source slide/page {audit.slides.join(", ")}</p>}
          {audit?.status === "found-unlocated" && <p className="mt-1 text-xs text-good">Code found in source text; page metadata unavailable</p>}
          {audit?.status === "not-found" && <p className="mt-1 text-xs text-warn">Code not found in this lecture’s extracted source; OCR may have omitted it.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`objective-lecture-${id}`}>Link objective to lecture</label>
            <select id={`objective-lecture-${id}`} disabled={disabled} value={targetId} onChange={(event) => setSelected((current) => ({ ...current, [id]: event.target.value }))} className="min-h-10 min-w-0 flex-1 rounded border border-border bg-panel px-2 text-sm disabled:opacity-50">
              <option value="">Unlinked</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{lectureLabel(candidate)}</option>)}
            </select>
            <Button variant="outline" disabled={disabled || !objective.id || !target || savingId === id || (sameLink && objective.manuallyAligned)} onClick={() => onConfirmLink?.(objective, target)}>
              {savingId === id ? "Saving…" : sameLink && objective.manuallyAligned ? "Confirmed" : sameLink ? "Confirm link" : "Save link"}
            </Button>
          </div>
        </article>;
      })}
      {!reviewRows.length && <p className="py-3 text-sm text-text-3">No linked or source-matched objectives to review. Use “Show all” to inspect the block list.</p>}
    </div>
  </details>;
}
