import { canViewQuestionDiagnostics } from "../diagnosticsAccess.js";
import { readQuestionDiagnostics } from "../questionDiagnostics.js";
import { QuestionPreparationDetails } from "./features/lectures/QuestionPreparationDetails.jsx";
import { ObjectiveIntegrityAdmin } from "./ObjectiveIntegrityAdmin.jsx";

export function QuestionDiagnosticsAdmin({ userId, lectures = [], onBack }) {
  if (!canViewQuestionDiagnostics(userId)) return null;
  const reports = lectures.map(lecture => ({ lecture, report: readQuestionDiagnostics(userId, lecture.id) })).filter(row => row.report);
  return <section className="mx-auto max-w-5xl p-5">
    <button onClick={onBack} className="mb-4 text-sm text-text-2">← More</button>
    <h2 className="text-xl font-semibold">Question generation diagnostics</h2>
    <p className="mb-5 text-sm text-text-2">Admin tools · recent runs from this browser session.</p>
    {!reports.length && <p>No recent preparation reports in this session.</p>}
    {reports.map(({ lecture, report }) => <div key={lecture.id} className="mb-5">
      <h3 className="mb-2 font-semibold">{lecture.title || lecture.name || "Lecture"}</h3>
      <QuestionPreparationDetails report={report} />
    </div>)}
    <details className="mt-8 rounded-lg border border-border bg-panel p-4">
      <summary className="cursor-pointer font-semibold">Objective/source integrity tools <span className="ml-2 text-xs font-normal text-text-3">technical</span></summary>
      <ObjectiveIntegrityAdmin userId={userId} />
    </details>
  </section>;
}
