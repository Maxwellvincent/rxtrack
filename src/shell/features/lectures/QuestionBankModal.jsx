import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import * as questionBankMetaStore from "../../../stores/questionBankMeta.js";
import * as schoolResultsStore from "../../../stores/schoolResults.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { collectStyleSources, downloadStyleSources } from "../../../engine/styleDataset.js";
import * as questionRatingsStore from "../../../stores/questionRatings.js";
import * as questionBankAnalysisStore from "../../../stores/questionBankAnalysis.js";
import { sourceLabel } from "../../logic/questionBankAnalysis.js";
import { processQuestionBankFiles } from "../../logic/questionBankImport.js";
import { startBackgroundJob } from "../../backgroundJobs.js";

export function QuestionBankModal({ blockId, blockName = "", lectures = [], objectives = [], userId = null, onClose, onUploaded }) {
  const banksRes = useQuestionBanks(userId);
  const schoolResultsRes = useStoreResource(schoolResultsStore, userId);
  const banks = banksRes.data;
  const [wrongOnly, setWrongOnly] = useState(false);
  const [sourceKind, setSourceKind] = useState("school");
  const [useLlm, setUseLlm] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showAllBanks, setShowAllBanks] = useState(false);
  const [, setMetaRevision] = useState(0);

  useEffect(() => questionBankMetaStore.subscribe(() => setMetaRevision((value) => value + 1)), []);

  const onFiles = useCallback(
    (files, sourceKindOverride = null) => {
      const selectedFiles = Array.from(files || []);
      if (!selectedFiles.length) return;
      const uploadSourceKind = sourceKindOverride || sourceKind;
      startBackgroundJob({
        label: `Importing ${selectedFiles.length} question-bank file${selectedFiles.length === 1 ? "" : "s"}`,
        detail: "Queued · opening files…",
        run: (update) => processQuestionBankFiles({
          selectedFiles,
          blockId,
          blockName,
          lectures,
          objectives,
          userId,
          wrongOnly,
          sourceKind: uploadSourceKind,
          useLlm,
          schoolResultsData: schoolResultsRes.data,
          schoolResultsLoading: schoolResultsRes.loading,
          schoolResultsError: schoolResultsRes.error,
          schoolResultsMutate: schoolResultsRes.mutate,
          update,
          onUploaded,
        }),
      });
      onClose?.();
    },
    [blockId, blockName, lectures, objectives, userId, wrongOnly, sourceKind, useLlm, onClose, onUploaded, schoolResultsRes]
  );

  const remove = useCallback(
    (filename) => {
      questionBanksStore.removeBank(userId, filename);
      const meta = questionBankMetaStore.read(userId) || {};
      questionBankMetaStore.write(userId, Object.fromEntries(Object.entries(meta).filter(([, entry]) => entry?.filename !== filename)));
      onUploaded?.();
    },
    [userId, onUploaded]
  );

  const meta = questionBankMetaStore.read(userId) || {};
  const blockNames = new Set(Object.values(meta).filter((entry) => entry?.blockId === blockId).map((entry) => entry.filename));
  for (const [filename, questions] of Object.entries(banks || {})) {
    if (questions?.some((question) => question?.blockId === blockId)) blockNames.add(filename);
  }
  const allNames = Object.keys(banks).sort();
  const names = (showAllBanks ? allNames : allNames.filter((name) => blockNames.has(name)));
  const totalQuestions = names.reduce((n, name) => n + (banks[name]?.length || 0), 0);
  const styleSources = collectStyleSources(banks, meta, questionRatingsStore.read(userId).ratings || {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:py-8" onClick={onClose}>
      <div className="desk-question-bank-modal flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-xl sm:max-h-[calc(100dvh-4rem)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="text-lg font-bold text-text-1">Import school questions & homework</div>
          <button type="button" onClick={onClose} className="p-1 text-text-3 hover:text-text-1" aria-label="Close question banks">✕</button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
        <div className="mb-4 font-mono text-[12px] text-text-3">
          Uploaded ExamSoft, homework, IMCQ, and in-class clicker examples remain available under Exam and guide lecture quizzes and question generation.
          Each bank is analyzed for source-key coverage, objective focus, lecture support, clinical cues, and critique.
          A score report (with a category-by-category breakdown) also flags your weak categories automatically.
          After you choose files, this window closes and the import continues in the background; progress and completion appear in the notification center.
          Re-uploading the same filename replaces its existing bank.
          {totalQuestions > 0 && <> · <span className="text-text-2">{names.length} banks · {totalQuestions} q</span></>}
        </div>

        <div className="mb-4 flex gap-1 border-b border-border" aria-label="Question bank scope">
          <button type="button" onClick={() => setShowAllBanks(false)} className={`border-b-2 px-3 py-2 text-sm font-bold ${!showAllBanks ? "border-accent text-accent-text" : "border-transparent text-text-3"}`}>This block</button>
          <button type="button" onClick={() => setShowAllBanks(true)} className={`border-b-2 px-3 py-2 text-sm font-bold ${showAllBanks ? "border-accent text-accent-text" : "border-transparent text-text-3"}`}>All banks · {allNames.length}</button>
        </div>

        <div className="mb-3 flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4" aria-label="Question source type">
            <button type="button" onClick={() => setSourceKind("school")} className={`rounded-lg border p-2 text-left text-xs ${sourceKind === "school" ? "border-accent bg-accent-soft text-text-1" : "border-border text-text-3"}`}>
              <span className="block font-bold">Official school questions</span>
              <span>Guides school-style generation</span>
            </button>
            <button type="button" onClick={() => setSourceKind("supplemental")} className={`rounded-lg border p-2 text-left text-xs ${sourceKind === "supplemental" ? "border-accent bg-accent-soft text-text-1" : "border-border text-text-3"}`}>
              <span className="block font-bold">Homework / supplemental</span>
              <span>Task types and misconceptions</span>
            </button>
            <button type="button" onClick={() => setSourceKind("imcq")} className={`rounded-lg border p-2 text-left text-xs ${sourceKind === "imcq" ? "border-accent bg-accent-soft text-text-1" : "border-border text-text-3"}`}>
              <span className="block font-bold">IMCQ source</span>
              <span>Challenge format and clues</span>
            </button>
            <button type="button" onClick={() => setSourceKind("clicker")} className={`rounded-lg border p-2 text-left text-xs ${sourceKind === "clicker" ? "border-accent bg-accent-soft text-text-1" : "border-border text-text-3"}`}>
              <span className="block font-bold">In-class clickers</span>
              <span>Clinical clues and images</span>
            </button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
            <input type="checkbox" checked={wrongOnly} onChange={(e) => setWrongOnly(e.target.checked)} />
            These are questions I got wrong
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
            LLM cleanup — for scanned/image-heavy PDFs
          </label>
        </div>

        <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">{schoolResultsRes.loading ? "Syncing school-result history…" : "Add exam PDFs"}</span>
          <span className="font-mono text-[12px] text-text-3">pdf · md · txt</span>
          <input
            type="file"
            multiple
            accept=".pdf,.md,.txt"
            className="hidden"
            disabled={schoolResultsRes.loading || !!schoolResultsRes.error}
            onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; onFiles(fs); }}
          />
        </label>
        <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-sm hover:border-accent">
          <span className="text-text-1"><span className="block font-semibold">Import a homework folder</span><span className="text-xs text-text-3">Select a local Practice Questions folder; files are assigned to this block.</span></span>
          <span className="font-mono text-[12px] text-accent-text">folder</span>
          <input
            type="file"
            multiple
            webkitdirectory="true"
            directory="true"
            accept=".pdf,.md,.markdown,.txt"
            className="hidden"
            disabled={schoolResultsRes.loading || !!schoolResultsRes.error}
            onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; onFiles(fs, "supplemental"); }}
          />
        </label>
        <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-sm hover:border-accent">
          <span className="text-text-1"><span className="block font-semibold">Import in-class clicker images</span><span className="text-xs text-text-3">Select the clicker folder or its screenshots. Complete stems are grouped into one example bank; unkeyed slides stay example-only.</span></span>
          <span className="font-mono text-[12px] text-accent-text">images</span>
          <input
            type="file"
            multiple
            webkitdirectory="true"
            directory="true"
            accept=".png,.jpg,.jpeg,.webp"
            className="hidden"
            disabled={schoolResultsRes.loading || !!schoolResultsRes.error}
            onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; onFiles(fs, "clicker"); }}
          />
        </label>
        <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">Add clicker image files</span>
          <span className="font-mono text-[12px] text-text-3">png · jpg · webp</span>
          <input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp"
            className="hidden"
            disabled={schoolResultsRes.loading || !!schoolResultsRes.error}
            onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; onFiles(fs, "clicker"); }}
          />
        </label>

          {names.length > 0 && (
          <div className="mb-3">
            <button
              onClick={() => setShowManage((s) => !s)}
              className="font-mono text-[12px] text-text-3 hover:text-text-1"
            >
              {showManage ? "▾ hide" : "▸ manage"} {names.length} bank{names.length === 1 ? "" : "s"}
            </button>
            {showManage && (
              <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-border">
                {names.map((name) => (
                  <div key={name} className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-0 text-[13px]">
                    <span className="flex-1 truncate text-text-2">{name}</span>
                    <span className="font-mono text-text-3">{banks[name]?.length || 0} q</span>
                    <span className="font-mono text-[11px] text-text-3">{sourceLabel(meta[Object.keys(meta).find((id) => meta[id]?.filename === name)]?.sourceKind, name)}</span>
                    {questionBankAnalysisStore.read(userId, name)?.status === "reviewed" && <span className="font-mono text-[11px] text-good">analyzed</span>}
                    {banks[name]?.[0]?.bankType === "wrong" && <span className="font-mono text-[13px] text-warn">missed</span>}
                    <button className="text-bad hover:underline" onClick={() => remove(name)}>✕</button>
                  </div>
                ))}
              </div>
          )}
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2">
            <span className="text-xs text-text-2">Style-training export · {styleSources.length} ExamSoft/IMCQ questions</span>
            <button type="button" disabled={!styleSources.length} onClick={() => downloadStyleSources(styleSources)} className="font-mono text-[12px] text-accent hover:underline disabled:opacity-40">export JSON</button>
          </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default QuestionBankModal;
