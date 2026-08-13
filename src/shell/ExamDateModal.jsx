import { useState, useCallback } from "react";
import { Button } from "../ui/Button.jsx";
import * as examDatesStore from "../stores/examDates.js";
import * as termsStore from "../stores/terms.js";
import { useExamDates } from "./hooks/useExamDates.js";
import { useTerms } from "./hooks/useTerms.js";

export function ExamDateModal({ blockId, blockName, termId, userId, currentStartDate, onClose }) {
  const examDates = useExamDates(userId);
  const terms = useTerms(userId);
  const currentExam = examDates.data?.[blockId] ?? null;

  // Try to find block startDate from terms if not passed directly
  const blockInTerms = terms.data
    ?.flatMap((t) => (t.blocks || []).map((b) => ({ ...b, _termId: t.id })))
    .find((b) => b.id === blockId);
  const resolvedStartDate = currentStartDate ?? blockInTerms?.startDate ?? null;

  const [examInput, setExamInput] = useState(currentExam || "");
  const [startInput, setStartInput] = useState(resolvedStartDate || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useCallback(async () => {
    if (!examInput && !startInput) return;
    setSaving(true);
    try {
      // Save exam date
      if (examInput) {
        const store = examDatesStore.read(userId) || {};
        await examDatesStore.write(userId, { ...store, [blockId]: examInput });
      }

      // Save block start date into the terms tree
      if (startInput) {
        const allTerms = termsStore.read(userId) || [];
        const tid = termId ?? blockInTerms?._termId;
        const nextTerms = allTerms.map((t) => {
          if (t.id !== tid) return t;
          return {
            ...t,
            blocks: (t.blocks || []).map((b) =>
              b.id === blockId ? { ...b, startDate: startInput } : b
            ),
          };
        });
        await termsStore.write(userId, nextTerms);
      }

      setSaved(true);
      setTimeout(onClose, 800);
    } finally {
      setSaving(false);
    }
  }, [blockId, termId, userId, examInput, startInput, blockInTerms, onClose]);

  const fmt = (d) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Block dates</div>
        <div className="mb-4 font-mono text-[10px] text-text-3">{blockName || blockId}</div>

        <div className="flex flex-col gap-4">
          {/* Block start date */}
          <div>
            <div className="mb-1 text-xs font-semibold text-text-1">Block start date</div>
            <div className="mb-1.5 font-mono text-[10px] text-text-3">
              First day of class — used to compute lecture dates from week numbers.
              {resolvedStartDate && <> Currently: <span className="text-text-2">{fmt(resolvedStartDate)}</span></>}
            </div>
            <input
              type="date"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              className="w-full rounded border border-border bg-panel px-2 py-1.5 font-mono text-sm text-text-1 focus:border-border-strong focus:outline-none"
            />
          </div>

          {/* Exam date */}
          <div>
            <div className="mb-1 text-xs font-semibold text-text-1">Exam date</div>
            <div className="mb-1.5 font-mono text-[10px] text-text-3">
              Today schedules backwards from this. Spaced-rep windows are sized by days remaining.
              {currentExam && <> Currently: <span className="text-text-2">{fmt(currentExam)}</span></>}
            </div>
            <input
              type="date"
              value={examInput}
              onChange={(e) => setExamInput(e.target.value)}
              className="w-full rounded border border-border bg-panel px-2 py-1.5 font-mono text-sm text-text-1 focus:border-border-strong focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button onClick={onClose} className="font-mono text-[10px] text-text-3 hover:text-text-1">cancel</button>
          <Button onClick={save} disabled={(!examInput && !startInput) || saving || saved}>
            {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
