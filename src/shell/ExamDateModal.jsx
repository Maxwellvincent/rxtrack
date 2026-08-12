import { useState, useCallback } from "react";
import { Button } from "../ui/Button.jsx";
import * as examDatesStore from "../stores/examDates.js";
import { useExamDates } from "./hooks/useExamDates.js";

export function ExamDateModal({ blockId, blockName, userId, onClose }) {
  const examDates = useExamDates(userId);
  const current = examDates.data?.[blockId] ?? null;

  const [dateInput, setDateInput] = useState(current || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useCallback(async () => {
    if (!dateInput) return;
    setSaving(true);
    try {
      const store = examDatesStore.read(userId) || {};
      await examDatesStore.write(userId, { ...store, [blockId]: dateInput });
      setSaved(true);
      setTimeout(onClose, 800);
    } finally {
      setSaving(false);
    }
  }, [blockId, userId, dateInput, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Exam date</div>
        <div className="mb-1 font-mono text-[10px] text-text-3">
          {blockName || blockId}
        </div>
        <div className="mb-4 text-xs text-text-3">
          Today schedules backwards from this date. Lectures get spaced-rep windows based on how far out the exam is.
        </div>

        {current && (
          <div className="mb-3 font-mono text-[11px] text-text-2">
            Current: <span className="text-text-1">{new Date(current + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            className="flex-1 rounded border border-border bg-panel px-2 py-1.5 font-mono text-sm text-text-1 focus:border-border-strong focus:outline-none"
          />
          <Button onClick={save} disabled={!dateInput || saving || saved}>
            {saved ? "Saved ✓" : saving ? "Saving…" : current ? "Update" : "Set date"}
          </Button>
        </div>

        <div className="mt-3 flex justify-end">
          <button onClick={onClose} className="font-mono text-[10px] text-text-3 hover:text-text-1">cancel</button>
        </div>
      </div>
    </div>
  );
}
