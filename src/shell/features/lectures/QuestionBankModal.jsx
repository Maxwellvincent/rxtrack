/**
 * Upload past exams so generated questions sound like the real thing.
 *
 * Every parsed bank is stored under its filename and read back as few-shot
 * exemplars by the quiz generators. Marking an upload "questions I got wrong"
 * tags the bank so those questions weigh differently.
 *
 * This is the one exam surface that outlived App.jsx. App also ran the banks
 * through a model to attach testable facts to lectures and weak concepts; that
 * layer went with it.
 */
import { useCallback, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { parseExamPDF } from "../../../examParser.js";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import { summarizeBankUpload, tagBankQuestions } from "../../logic/questionBankIngest.js";

export function QuestionBankModal({ blockId, userId = null, onClose, onUploaded }) {
  // Through the hook, not a useState initializer: the banks arrive from
  // Firestore after the first paint, so a one-shot read showed "0 banks" on an
  // account with 51 of them.
  const banksRes = useQuestionBanks(userId);
  const banks = banksRes.data;
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState(null);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [useLlm, setUseLlm] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFiles = useCallback(
    async (files) => {
      if (!files.length) return;
      setBusy(true); setSummary(null); setStatus("");
      const results = [];
      try {
        for (const file of files) {
          try {
            setStatus(`${file.name} — reading…`);
            const parsed = await parseExamPDF(file, (msg) => setStatus(`${file.name} — ${msg}`), { useLlm });
            const questions = tagBankQuestions(parsed?.questions, {
              blockId,
              filename: file.name,
              wrongOnly,
            });
            if (questions.length) questionBanksStore.saveBank(userId, file.name, questions);
            results.push({ filename: file.name, questions });
          } catch (e) {
            results.push({ filename: file.name, error: e?.message || String(e) });
          }
        }
      } finally {
        setSummary(summarizeBankUpload(results));
        setStatus("");
        setBusy(false);
        onUploaded?.();
      }
    },
    [blockId, userId, wrongOnly, useLlm, onUploaded]
  );

  const remove = useCallback(
    (filename) => {
      questionBanksStore.removeBank(userId, filename);
      onUploaded?.();
    },
    [userId, onUploaded]
  );

  const names = Object.keys(banks).sort();
  const totalQuestions = Object.values(banks).reduce((n, qs) => n + (qs?.length || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={busy ? undefined : onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Exam question banks</div>
        <div className="mb-3 text-xs text-text-3">
          Upload past exam PDFs. The questions are parsed and kept as style exemplars, so generated
          questions match the way your school actually writes them. Nothing here is quizzed directly.
        </div>

        <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-text-2">
          <input type="checkbox" checked={wrongOnly} disabled={busy} onChange={(e) => setWrongOnly(e.target.checked)} />
          These are questions I got wrong
        </label>

        <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-text-2">
          <input type="checkbox" checked={useLlm} disabled={busy} onChange={(e) => setUseLlm(e.target.checked)} />
          LLM cleanup — slower, better for scanned/image-heavy PDFs
        </label>

        <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">{busy ? "Parsing…" : "Choose exam PDFs"}</span>
          <span className="font-mono text-[10px] text-text-3">pdf</span>
          <input
            type="file"
            multiple
            accept=".pdf"
            className="hidden"
            disabled={busy}
            // e.target.files is a live FileList — copy before clearing the input.
            onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; onFiles(fs); }}
          />
        </label>

        {status && <div className="mb-3 font-mono text-[11px] text-text-2">{status}</div>}
        {summary && (
          <div className="mb-3 font-mono text-[11px]">
            <div className="text-good">{summary.saved} of {summary.files} files · {summary.questions} questions</div>
            {summary.empty.map((f) => <div key={f} className="text-text-3">⚠ {f} — no questions detected</div>)}
            {summary.failed.map((f) => <div key={f} className="text-bad">✕ {f}</div>)}
          </div>
        )}

        <div className="mb-3 flex-1 overflow-y-auto rounded-lg border border-border">
          {names.length === 0 ? (
            <div className="px-3 py-4 text-xs text-text-3">No banks uploaded yet.</div>
          ) : (
            <table className="w-full text-left text-[11px]">
              <tbody>
                {names.map((name) => (
                  <tr key={name} className="border-b border-border last:border-0">
                    <td className="px-2 py-1 text-text-1">{name}</td>
                    <td className="px-2 py-1 font-mono text-text-3">{banks[name]?.length || 0} q</td>
                    <td className="px-2 py-1 font-mono text-text-3">{banks[name]?.[0]?.bankType === "wrong" ? "missed" : ""}</td>
                    <td className="px-2 py-1 text-right">
                      <button className="text-bad hover:underline" disabled={busy} onClick={() => remove(name)}>remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="flex-1 font-mono text-[11px] text-text-3">{names.length} banks · {totalQuestions} questions</span>
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export default QuestionBankModal;
