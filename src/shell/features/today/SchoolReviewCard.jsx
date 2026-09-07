import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { listExamSessions } from "../../../supabase.js";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import { useQuestionBankMeta } from "../../hooks/useQuestionBankMeta.js";
import { nextSchoolReview } from "./schoolReviewPlan.js";

export function SchoolReviewCard({ blockId, userId, examDate, onOpenExam }) {
  const banks = useQuestionBanks(userId);
  const meta = useQuestionBankMeta(userId);
  const [history, setHistory] = useState({ loading: true, error: false, sessions: [] });
  useEffect(() => {
    let active = true;
    setHistory({ loading: true, error: false, sessions: [] });
    listExamSessions(userId, blockId, { status: "submitted" })
      .then((sessions) => { if (active) setHistory({ loading: false, error: false, sessions: sessions || [] }); })
      .catch(() => { if (active) setHistory({ loading: false, error: true, sessions: [] }); });
    return () => { active = false; };
  }, [userId, blockId]);
  const scopedBanks = useMemo(() => Object.values(meta.data || {})
    .filter((entry) => entry?.blockId === blockId && banks.data?.[entry.filename])
    .map((entry) => ({ ...entry, questions: banks.data[entry.filename] })), [meta.data, banks.data, blockId]);
  const plan = useMemo(() => nextSchoolReview({ banks: scopedBanks, sessions: history.sessions, examDate }), [scopedBanks, history.sessions, examDate]);
  if (banks.loading || meta.loading || history.loading || history.error || !plan) return null;
  return <section aria-label="Next school quiz pass" className="rounded-xl border border-border bg-bg-elevated p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-2">Next ExamSoft pass · {plan.pass}/3</p>
        <h2 className="mt-1 text-base font-semibold">{plan.title}</h2>
        <p className="mt-1 text-sm text-text-2">{plan.mode} · {plan.purpose}{plan.due ? " Due now." : ` Suggested ${new Date(plan.dueAt).toLocaleDateString()}.`}</p>
      </div>
      <Button variant={plan.due ? "primary" : "outline"} onClick={onOpenExam}>Open school quizzes</Button>
    </div>
  </section>;
}
