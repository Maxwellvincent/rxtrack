import {ReviewSourceStatus} from './ReviewSourceStatus.jsx';
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import * as questionBankMetaStore from "../../../stores/questionBankMeta.js";
import * as schoolResultsStore from "../../../stores/schoolResults.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { sourceLabel } from "../../logic/questionBankAnalysis.js";
import { processQuestionBankFiles } from "../../logic/questionBankImport.js";
import { startBackgroundJob } from "../../backgroundJobs.js";

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const ACCEPT = ".pdf,.pptx,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp";
const SOURCE_TYPES = [
  { id: "school", label: "ExamSoft / exam", hint: "Official exam questions. They shape the style of generated questions." },
  { id: "imcq", label: "IMCQ", hint: "IMCQ decks. Add the answer-key deck and its explanation handout together; duplicates are merged." },
  { id: "supplemental", label: "Homework", hint: "Homework, practice sets, NBME or other outside questions. A folder of homework works too." },
  { id: "clicker", label: "Clickers", hint: "In-class clicker slides or screenshots. Unkeyed slides are kept as examples only." },
];

export function QuestionBankModal({ blockId, blockName = "", defaultSourceKind = "school", lectures = [], objectives = [], userId = null, onClose, onUploaded }) {
  const banksRes = useQuestionBanks(userId);
  const schoolResultsRes = useStoreResource(schoolResultsStore, userId);
  const banks = banksRes.data;
  const [wrongOnly, setWrongOnly] = useState(false);
  const [sourceKind, setSourceKind] = useState(defaultSourceKind);
  const [useLlm, setUseLlm] = useState(false);
  const [reserveForEvaluation,setReserveForEvaluation]=useState(false);
  const [confirming, setConfirming] = useState(null);
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
          useLlm:reserveForEvaluation ? false : useLlm,
          reserveForEvaluation,
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
    [blockId, blockName, lectures, objectives, userId, wrongOnly, sourceKind, useLlm, reserveForEvaluation, onClose, onUploaded, schoolResultsRes]
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

  const disabled = banksRes.loading || !!banksRes.error || schoolResultsRes.loading || !!schoolResultsRes.error;
  const pick = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    // Screenshots alone are clicker slides; stray images in a document folder are skipped.
    // The importer reads screenshots only as clicker slides (example-only until keyed), so say so.
    if (files.length && files.every((file) => IMAGE_FILE.test(file.name))) {
      if (sourceKind !== "clicker" && !window.confirm("Screenshots import as clicker examples: practice-only until keyed, and not used in mixed exams. For scored questions, upload the PDF instead. Continue?")) return;
      return onFiles(files, "clicker");
    }
    onFiles(sourceKind === "clicker" ? files : files.filter((file) => !IMAGE_FILE.test(file.name)));
  };
  const metaFor = (name) => meta[Object.keys(meta).find((id) => meta[id]?.filename === name)];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:py-8" onClick={onClose}>
      <div className="desk-question-bank-modal flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-xl sm:max-h-[calc(100dvh-4rem)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <div className="text-lg font-bold text-text-1">Question banks</div>
            <div className="text-xs text-text-3">{blockName || "This block"}{totalQuestions > 0 ? ` · ${names.length} banks · ${totalQuestions} questions` : ""}</div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-text-3 hover:text-text-1" aria-label="Close question banks">✕</button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-1 text-sm font-semibold text-text-1">1 · What are you uploading?</p>
          <div className="mb-1 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Question source type">
            {SOURCE_TYPES.map((type) => (
              <button key={type.id} type="button" role="radio" aria-checked={sourceKind === type.id} onClick={() => setSourceKind(type.id)}
                className={`rounded-lg border px-2 py-1.5 text-left text-xs ${sourceKind === type.id ? "border-accent bg-accent-soft font-semibold text-text-1" : "border-border text-text-2"}`}>
                {sourceKind === type.id ? "● " : "○ "}{type.label}
              </button>
            ))}
          </div>
          <p className="mb-4 text-xs text-text-3">{SOURCE_TYPES.find((type) => type.id === sourceKind)?.hint}</p>

          <p className="mb-1 text-sm font-semibold text-text-1">2 · Choose files</p>
          <div className="mb-1 grid grid-cols-2 gap-2">
            <label className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border px-3 py-3 text-sm text-text-1 hover:border-border-strong ${disabled ? "opacity-50" : ""}`}>
              {schoolResultsRes.loading ? "Syncing…" : "Choose files"}
              <input type="file" multiple accept={ACCEPT} className="hidden" disabled={disabled} onChange={pick} />
            </label>
            <label className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border px-3 py-3 text-sm text-text-1 hover:border-border-strong ${disabled ? "opacity-50" : ""}`}>
              Choose a folder
              <input type="file" multiple webkitdirectory="true" directory="true" accept={ACCEPT} className="hidden" disabled={disabled} onChange={pick} />
            </label>
          </div>
          <p className="mb-3 text-xs text-text-3">PDF, PowerPoint, text or screenshots. Pick a question file and its answer key or explanations together and they are matched. Re-uploading a filename updates that bank and keeps your progress. The import runs in the background.</p>

          <details className="mb-4 text-xs text-text-2">
            <summary className="cursor-pointer text-text-3">Options</summary>
            <div className="mt-2 flex flex-col gap-1.5">
              <label className="flex items-center gap-2"><input type="checkbox" checked={wrongOnly} onChange={(e) => setWrongOnly(e.target.checked)} />Only questions I got wrong</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />AI cleanup for scanned or image-heavy PDFs (slower)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={reserveForEvaluation} onChange={(e) => setReserveForEvaluation(e.target.checked)} />Hold out for testing: practice only, never used as examples for new questions</label>
            </div>
          </details>

          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text-1">Uploaded</p>
            <div className="flex gap-1 text-xs" role="group" aria-label="Question bank scope">
              <button type="button" aria-pressed={!showAllBanks} onClick={() => setShowAllBanks(false)} className={`rounded border px-2 py-0.5 ${!showAllBanks ? "border-accent font-semibold" : "border-border text-text-3"}`}>This block</button>
              <button type="button" aria-pressed={showAllBanks} onClick={() => setShowAllBanks(true)} className={`rounded border px-2 py-0.5 ${showAllBanks ? "border-accent font-semibold" : "border-border text-text-3"}`}>All · {allNames.length}</button>
            </div>
          </div>
          {names.length ? (
            <ul className="mb-3 max-h-64 overflow-y-auto rounded-lg border border-border">
              {names.map((name) => (
                <li key={name} className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[13px] last:border-0">
                  <span className="min-w-0 flex-1 truncate text-text-1" title={name}>{name}</span>
                  <span className="shrink-0 text-xs text-text-3">{sourceLabel(metaFor(name)?.sourceKind, name)} · {banks[name]?.length || 0} q{banks[name]?.[0]?.bankType === "wrong" ? " · missed" : ""}</span>
                  {confirming === name
                    ? <span className="flex shrink-0 gap-1 text-xs"><button type="button" className="font-semibold underline" onClick={() => { remove(name); setConfirming(null); }}>Delete</button><button type="button" className="text-text-3 underline" onClick={() => setConfirming(null)}>Keep</button></span>
                    : <button type="button" aria-label={`Delete ${name}`} className="shrink-0 px-1 text-text-3 hover:text-text-1" onClick={() => setConfirming(name)}>✕</button>}
                </li>
              ))}
            </ul>
          ) : <p className="mb-3 text-xs text-text-3">◇ Nothing uploaded{showAllBanks ? "" : " for this block"} yet.</p>}

          <ReviewSourceStatus userId={userId} blockId={blockId} />

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default QuestionBankModal;
