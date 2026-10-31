import { useStoreResource } from "./hooks/useStoreResource.js";
import * as generatedQuestionsStore from "../stores/generatedQuestions.js";
import * as questionBanksStore from "../stores/questionBanks.js";
import { buildQuestionAuditBaseline, downloadQuestionAuditBaseline } from "../engine/questionAuditBaseline.js";

function BaselineExport({userId}) {
 const generated=useStoreResource(generatedQuestionsStore,userId);
 const banks=useStoreResource(questionBanksStore,userId);
 const loading=generated.loading || banks.loading;
 const error=generated.error || banks.error;
 return <details className="mb-5 rounded-lg border border-border p-4">
  <summary className="cursor-pointer font-semibold">Question quality baseline</summary>
  <p className="mt-2 text-sm text-text-2">Download a local review sample: up to 48 saved generated questions and 12 each from homework, ESoft, IMCQ and in-class questions. Unkeyed in-class examples are marked for wording review only. No questions or progress are changed. Figures remain in their original sources.</p>
  <button type="button" disabled={loading || !!error} onClick={()=>downloadQuestionAuditBaseline(buildQuestionAuditBaseline({generated:generated.data,banks:banks.data}))} className="mt-3 rounded border border-border px-3 py-2 text-sm disabled:opacity-40">{loading?"Loading saved questions…":"Download review sample"}</button>
  {error && <p role="alert" className="mt-2 text-sm">Saved questions could not be loaded. Retry after reconnecting; an incomplete sample was not exported.</p>}
 </details>;
}

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
    <BaselineExport userId={userId} />
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
