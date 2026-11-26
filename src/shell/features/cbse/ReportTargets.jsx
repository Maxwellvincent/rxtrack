import { useEffect, useMemo, useState } from "react";
import { categoryPracticeSet, reportTargetRows, IMPROVED_ACCURACY, IMPROVED_MIN_ANSWERS, IMPROVED_MIN_DAYS } from "../../logic/reportTargets.js";
import { mapReportTargets } from "../../logic/mapReportTargets.js";
import { readyGeneratedForLectures } from "../../logic/reportTargetPool.js";
import { GENERATED_TARGET, storedGeneratedForLectures, topUpCategoryQuestions } from "../../logic/reportTargetTopUp.js";
import * as generatedStore from "../../../stores/generatedQuestions.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { cbseQuestionKey } from "./cbsePrep.js";

// One background top-up at a time per learner, across remounts.
const toppingUp = new Set();
const pct = value => value == null ? "—" : `${Math.round(value * 100)}%`;
const FORMAT_LABELS = [["homework", "homework"], ["imcq", "IMCQ"], ["esoft", "ESoft"], ["other", "other school"]];

/** "6 homework · 4 IMCQ · 3 ESoft" */
export function formatCounts(formats = {}) {
  return FORMAT_LABELS.filter(([id]) => formats[id]).map(([id, label]) => `${formats[id]} ${label}`).join(" · ");
}

/**
 * Score report categories ranked as study targets: each with its lectures,
 * objectives, matching school questions by format, practice since the report,
 * and a launch for that category's questions.
 */
export function ReportTargets({ userId, weakConcepts, pool, sessions, calibration, itemHistory, lectureTitles = {}, blockNames = {}, busy = false, refreshKey = 0, onPractice, onReviewLecture }) {
  // Prepared, unused generated questions on the categories' lectures.
  const targetLectureKey = useMemo(() => [...new Set(Object.values(weakConcepts || {}).flatMap(entries => (Array.isArray(entries) ? entries : []).flatMap(entry => entry?.reportTarget?.lectureIds || [])))].sort().join(","), [weakConcepts]);
  const [generated, setGenerated] = useState({ key: null, questions: [], error: "" });
  useEffect(() => {
    let alive = true;
    if (!userId || !targetLectureKey) return undefined;
    readyGeneratedForLectures(userId, targetLectureKey.split(","))
      .then(questions => { if (alive) setGenerated({ key: targetLectureKey, questions, error: "" }); })
      .catch(problem => { if (alive) setGenerated({ key: targetLectureKey, questions: [], error: problem.message || "Could not load generated questions." }); });
    return () => { alive = false; };
  }, [userId, targetLectureKey, refreshKey]);
  // Plus unused questions saved by lecture study for those lectures.
  const generatedResource = useStoreResource(generatedStore, userId);
  const generatedQuestions = useMemo(() => {
    const pooled = generated.key === targetLectureKey ? generated.questions : [];
    const stored = targetLectureKey ? storedGeneratedForLectures(userId, targetLectureKey.split(",")) : [];
    const seen = new Set(pooled.map(question => String(question.stem || "").toLowerCase().replace(/\s+/g, " ").trim()));
    return [...pooled, ...stored.filter(question => !seen.has(String(question.stem || "").toLowerCase().replace(/\s+/g, " ").trim()))];
    // generatedResource.data re-reads the store when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated, targetLectureKey, userId, generatedResource.data]);
  const rows = useMemo(() => reportTargetRows({ weakConcepts, pool, generated: generatedQuestions, sessions, calibration }), [weakConcepts, pool, generatedQuestions, sessions, calibration]);
  const [mapping, setMapping] = useState(false), [status, setStatus] = useState(""), [showAll, setShowAll] = useState(false), [topUp, setTopUp] = useState("");
  const unmappedBlocks = [...new Set(rows.filter(row => !row.mapped).map(row => row.entry.blockId))];
  const topics = rows.filter(row => !row.broad);
  const broad = rows.filter(row => row.broad);
  const visible = showAll ? topics : topics.slice(0, 8);

  const mapAll = async () => {
    setMapping(true); setStatus("");
    const done = [];
    try {
      for (const blockId of unmappedBlocks) {
        setStatus(`Mapping ${blockNames[blockId] || blockId}…`);
        const result = await mapReportTargets({ userId, blockId });
        done.push(`${blockNames[blockId] || blockId}: ${result.mapped}/${result.total}`);
      }
      setStatus(`✓ Mapped ${done.join(" · ")}`);
    } catch (problem) { setStatus(`✕ ${problem.message || problem}${done.length ? ` (done: ${done.join(" · ")})` : ""}`); }
    finally { setMapping(false); }
  };

  // Keep the top open categories stocked with generated questions.
  const lowStock = rows.filter(row => row.mapped && !row.broad && !row.practice.improved && row.generated.length < GENERATED_TARGET).slice(0, 3);
  const lowKey = generated.key === targetLectureKey && !generatedResource.loading ? lowStock.map(row => `${row.entry.id}:${row.generated.length}`).join("|") : "";
  useEffect(() => {
    if (!lowKey || toppingUp.has(userId)) return;
    toppingUp.add(userId);
    (async () => {
      for (const row of lowStock) {
        const result = await topUpCategoryQuestions({ userId, target: row.target, have: row.generated.length,
          onProgress: ({ lectureTitle, count }) => setTopUp(`Generating ${count} questions for ${row.entry.concept} (${lectureTitle})…`) });
        setTopUp(result.errors.length ? `⚠ ${row.entry.concept}: ${result.errors[0]}` : `✓ ${result.added} new generated questions for ${row.entry.concept}`);
      }
    })().finally(() => toppingUp.delete(userId));
    // lowStock is derived from lowKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowKey, userId]);

  if (!rows.length) return null;
  return <section aria-label="Report targets" className="rounded-xl border border-border p-5">
    <h2 className="text-lg font-semibold">Report targets</h2>
    <p className="mt-1 text-sm text-text-2">Weak categories from your uploaded score reports, biggest gap on the most questions first. Category practice mixes school questions with about 40% generated questions on its lectures; the top open categories are topped up in the background when fewer than 8 unused generated questions remain. A category is ✓ improved after {IMPROVED_MIN_ANSWERS}+ answers on its material at {pct(IMPROVED_ACCURACY)} or better across {IMPROVED_MIN_DAYS}+ days since the report.</p>
    {unmappedBlocks.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <span>⚠ {rows.filter(row => !row.mapped).length} categories not linked to lectures and school questions yet.</span>
      <button type="button" disabled={mapping} className="rounded border border-accent px-3 py-2 font-semibold disabled:opacity-40" onClick={mapAll}>{mapping ? "Mapping…" : "Map report categories"}</button>
    </div>}
    {status && <p role="status" className="mt-2 text-sm">{status}</p>}
    {topUp && <p role="status" className="mt-2 text-sm text-text-2">{topUp}</p>}
    {generated.error && <p role="status" className="mt-2 text-sm">⚠ Generated questions unavailable ({generated.error}); categories use school questions only.</p>}
    <div className="mt-3 space-y-2">
      {visible.map(row => {
        const { entry, target, practice } = row;
        const set = categoryPracticeSet(row, { itemHistory, keyOf: cbseQuestionKey });
        return <div key={`${entry.blockId}:${entry.id}`} className="rounded-lg border border-border p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong>{practice.improved ? "✓" : row.mapped ? "○" : "⚠"} {entry.concept}</strong>
            <span className="text-text-2">{entry.reportName || blockNames[entry.blockId] || "Report"} · {entry.reportScore != null ? `${Math.round(entry.reportScore)}%` : "score not read"}{entry.reportSampleSize ? ` on ${entry.reportSampleSize} questions` : ""}{entry.reportClassAverage != null ? ` · class ${Math.round(entry.reportClassAverage)}%` : " · goal 80%"}</span>
          </div>
          {row.mapped ? <>
            <p className="mt-1 text-text-2">{practice.improved ? "✓ Improved" : "○ Open"} · since report: {practice.answered ? `${practice.correct}/${practice.answered} correct (${pct(practice.accuracy)}) over ${practice.days} day${practice.days === 1 ? "" : "s"}` : "not practiced yet"}</p>
            <p className="mt-1 text-text-2">School questions: {row.school.length ? formatCounts(row.formats) : "none matched"} · {row.generated.length} generated ready{target.objectiveIds.length ? ` · ${target.objectiveIds.length} objective${target.objectiveIds.length === 1 ? "" : "s"}` : ""}</p>
            {target.lectureIds.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{target.lectureIds.map(id => <button key={id} type="button" className="rounded border border-border px-2 py-0.5 text-xs underline" onClick={() => onReviewLecture?.(id)}>{lectureTitles[id] || "Lecture"}</button>)}</div>}
            {set.length > 0 && <button type="button" disabled={busy} className="mt-2 rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-40" onClick={() => onPractice(entry, set, row)}>Practice this category ({set.length}{set.some(q => q.sourceKind === "generated") ? ` · ${set.filter(q => q.sourceKind === "generated").length} generated` : ""})</button>}
          </> : <p className="mt-1 text-text-2">Not linked yet{entry.linkedLecIds?.length ? ` · earlier guess: ${entry.linkedLecIds.map(id => lectureTitles[id] || "lecture").join(", ")}` : ""}</p>}
        </div>;
      })}
    </div>
    {topics.length > 8 && <button type="button" className="mt-2 text-sm text-accent underline" onClick={() => setShowAll(value => !value)}>{showAll ? "Show top 8" : `Show all ${topics.length}`}</button>}
    {broad.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Whole-exam skills · {broad.length}</summary>
      <p className="mt-1 text-xs text-text-3">Competency and discipline scores (e.g. Patient Care: Diagnosis) span the whole exam, so they are tracked by the topic rows above rather than practiced on their own.</p>
      <ul className="mt-2 space-y-1">{broad.map(row => <li key={`${row.entry.blockId}:${row.entry.id}`}>{row.entry.concept} · {row.entry.reportScore != null ? `${Math.round(row.entry.reportScore)}%` : "—"}{row.entry.reportSampleSize ? ` on ${row.entry.reportSampleSize}` : ""} · {row.entry.reportName || blockNames[row.entry.blockId] || ""}</li>)}</ul>
    </details>}
  </section>;
}
