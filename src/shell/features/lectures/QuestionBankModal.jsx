import { useCallback, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { parseExamPDF } from "../../../examParser.js";
import { callAIJSON } from "../../../aiClient.js";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import * as weakConceptsStore from "../../../stores/weakConcepts.js";
import { summarizeBankUpload, tagBankQuestions } from "../../logic/questionBankIngest.js";
import { analyzeExamReportWeakConcepts, mergeExamReportConcepts } from "../../logic/examReportWeakConcepts.js";

export function QuestionBankModal({ blockId, blockName = "", lectures = [], userId = null, onClose, onUploaded }) {
  const banksRes = useQuestionBanks(userId);
  const banks = banksRes.data;
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState(null);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [useLlm, setUseLlm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [weakConceptsFound, setWeakConceptsFound] = useState(null);

  const onFiles = useCallback(
    async (files) => {
      if (!files.length) return;
      setBusy(true); setSummary(null); setStatus(""); setWeakConceptsFound(null);
      const results = [];
      const weakCategories = [];
      try {
        for (const file of files) {
          try {
            setStatus(`${file.name} — reading…`);
            const parsed = await parseExamPDF(file, (msg) => setStatus(`${file.name} — ${msg}`), { useLlm });
            const questions = tagBankQuestions(parsed?.questions, { blockId, filename: file.name, wrongOnly });
            if (questions.length) questionBanksStore.saveBank(userId, file.name, questions);
            results.push({ filename: file.name, questions });

            if (blockId && userId) {
              setStatus(`${file.name} — checking for a score report…`);
              const { entries, categories } = await analyzeExamReportWeakConcepts(
                { text: parsed?.fullText, lectures, blockId, blockName },
                { callAIJSON }
              );
              if (entries.length) {
                const store = weakConceptsStore.read(userId) || {};
                const merged = mergeExamReportConcepts(store[blockId] || [], entries);
                weakConceptsStore.write(userId, { ...store, [blockId]: merged });
                weakCategories.push(...categories.filter((c) => entries.some((e) => e.concept === c.category)));
              }
            }
          } catch (e) {
            results.push({ filename: file.name, error: e?.message || String(e) });
          }
        }
      } finally {
        setSummary(summarizeBankUpload(results));
        if (weakCategories.length) setWeakConceptsFound(weakCategories);
        setStatus("");
        setBusy(false);
        onUploaded?.();
      }
    },
    [blockId, blockName, lectures, userId, wrongOnly, useLlm, onUploaded]
  );

  const remove = useCallback(
    (filename) => { questionBanksStore.removeBank(userId, filename); onUploaded?.(); },
    [userId, onUploaded]
  );

  const names = Object.keys(banks).sort();
  const totalQuestions = Object.values(banks).reduce((n, qs) => n + (qs?.length || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Question banks</div>
        <div className="mb-4 font-mono text-[12px] text-text-3">
          Past exam PDFs — parsed as style exemplars so generated questions match how your school writes them.
          A score report (with a category-by-category breakdown) also flags your weak categories automatically.
          {totalQuestions > 0 && <> · <span className="text-text-2">{names.length} banks · {totalQuestions} q</span></>}
        </div>

        <div className="mb-3 flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
            <input type="checkbox" checked={wrongOnly} disabled={busy} onChange={(e) => setWrongOnly(e.target.checked)} />
            These are questions I got wrong
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
            <input type="checkbox" checked={useLlm} disabled={busy} onChange={(e) => setUseLlm(e.target.checked)} />
            LLM cleanup — for scanned/image-heavy PDFs
          </label>
        </div>

        <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">{busy ? "Parsing…" : "Add exam PDFs"}</span>
          <span className="font-mono text-[12px] text-text-3">pdf · md · txt</span>
          <input
            type="file"
            multiple
            accept=".pdf,.md,.txt"
            className="hidden"
            disabled={busy}
            onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; onFiles(fs); }}
          />
        </label>

        {status && <div className="mb-3 font-mono text-[13px] text-text-2">{status}</div>}
        {summary && (
          <div className="mb-3 font-mono text-[13px]">
            <div className="text-good">{summary.saved} of {summary.files} files · {summary.questions} questions added</div>
            {summary.empty.map((f) => <div key={f} className="text-text-3">⚠ {f} — no questions detected</div>)}
            {summary.failed.map((f) => <div key={f} className="text-bad">✕ {f}</div>)}
          </div>
        )}
        {weakConceptsFound && (
          <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-2 font-mono text-[12px]">
            <div className="mb-1 text-text-2">Score report detected — flagged as weak, below class average:</div>
            {weakConceptsFound.map((c) => (
              <div key={c.category} className="text-warn">
                ⚠ {c.category} — {Math.round(c.myScore)}% (avg {Math.round(c.average)}%)
              </div>
            ))}
            <div className="mt-1 text-text-3">See these under More → Weak concepts.</div>
          </div>
        )}

        {names.length > 0 && (
          <div className="mb-3">
            <button
              onClick={() => setShowManage((s) => !s)}
              className="font-mono text-[12px] text-text-3 hover:text-text-1"
            >
              {showManage ? "▾ hide" : "▸ manage"} {names.length} bank{names.length === 1 ? "" : "s"}
            </button>
            {showManage && (
              <div className="mt-2 rounded-lg border border-border">
                {names.map((name) => (
                  <div key={name} className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-0 text-[13px]">
                    <span className="flex-1 truncate text-text-2">{name}</span>
                    <span className="font-mono text-text-3">{banks[name]?.length || 0} q</span>
                    {banks[name]?.[0]?.bankType === "wrong" && <span className="font-mono text-[13px] text-warn">missed</span>}
                    <button className="text-bad hover:underline" disabled={busy} onClick={() => remove(name)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>Done</Button>
        </div>
      </div>
    </div>
  );
}

export default QuestionBankModal;
