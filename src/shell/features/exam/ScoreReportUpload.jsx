import { useState } from "react";
import { importScoreReport } from "../../logic/scoreReportImport.js";

/**
 * Upload an ExamSoft score report (ESoft quiz or NB main exam "Strengths and
 * Improvement Opportunities"). Saves the overall score and turns weak
 * categories into weak concepts that drive repair and CBSE practice.
 */
export function ScoreReportUpload({ userId, blocks = [], defaultBlockId = "", lectures = [], objectivesForBlock = () => [], onImported = () => {} }) {
  const [blockId, setBlockId] = useState(defaultBlockId || blocks[0]?.id || "");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const block = blocks.find(item => item.id === blockId);

  async function upload() {
    setBusy(true); setError(""); setResult(null);
    try {
      const imported = await importScoreReport({ file, userId, blockId, blockName: block?.name || "",
        lectures: lectures.filter(lecture => lecture.blockId === blockId), objectives: objectivesForBlock(blockId) });
      setResult(imported); onImported(imported);
    } catch (problem) { setError(problem.message || String(problem)); } finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-border p-5">
    <h2 className="text-lg font-semibold">Upload a score report</h2>
    <p className="mt-1 text-sm text-text-2">ExamSoft “Strengths and Improvement Opportunities” PDF from an ESoft quiz or an NB exam. The overall score is saved, and categories below the class average — or below the 80% goal when the report has no average — become weak areas for repair and CBSE practice.</p>
    <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
      {blocks.length > 1 && <label>Block this report covers<select value={blockId} onChange={event => setBlockId(event.target.value)} className="mt-1 block rounded border border-border bg-bg p-2">
        {blocks.map(item => <option key={item.id} value={item.id}>{item.termName ? `${item.termName} · ` : ""}{item.name}</option>)}
      </select></label>}
      <label>Report PDF<input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-1 block" /></label>
      <button type="button" disabled={!file || !blockId || busy} onClick={upload} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-40">{busy ? "Reading report…" : "Upload report"}</button>
    </div>
    {error && <p className="mt-2 text-sm text-bad" role="alert">✕ {error}</p>}
    {result && <div className="mt-3 text-sm" role="status">
      {result.summary && <p>✓ Saved <strong>{result.summary.name}</strong>: {result.summary.percent}%{result.summary.total ? ` (${result.summary.correct}/${result.summary.total})` : ""}.</p>}
      {result.categoryError
        ? <p className="mt-1">⚠ Categories could not be read ({result.categoryError}). The overall score is saved; upload again when the AI bridge is available.</p>
        : result.weakCategories.length
          ? <><p className="mt-1 font-semibold">⚠ {result.weakCategories.length} weak area{result.weakCategories.length === 1 ? "" : "s"} of {result.categoryCount} categories:</p>
            <ul className="mt-1 list-disc pl-5">{result.weakCategories.sort((a, b) => a.myScore - b.myScore).map(category => <li key={category.category}>{category.category} — {Math.round(category.myScore)}% ({category.correct}/{category.total}){Number.isFinite(category.average) ? ` vs class ${Math.round(category.average)}%` : ""}</li>)}</ul></>
          : <p className="mt-1">✓ No category met the weak-area rule ({result.categoryCount} read).</p>}
    </div>}
  </section>;
}
