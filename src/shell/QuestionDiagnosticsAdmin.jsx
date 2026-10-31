import { useStoreResource } from "./hooks/useStoreResource.js";
import * as generatedQuestionsStore from "../stores/generatedQuestions.js";
import * as questionBanksStore from "../stores/questionBanks.js";
import { buildQuestionAuditBaseline, downloadQuestionAuditBaseline, schoolSourceInventory } from "../engine/questionAuditBaseline.js";

function BaselineExport({userId}) {
 const generated=useStoreResource(generatedQuestionsStore,userId);
 const banks=useStoreResource(questionBanksStore,userId);
 const loading=generated.loading || banks.loading;
 const error=generated.error || banks.error;
 const inventory=schoolSourceInventory(banks.data);
 const kinds=["homework","examsoft","imcq","clicker","school"];
 return <details className="mb-5 rounded-lg border border-border p-4">
  <summary className="cursor-pointer font-semibold">Question quality baseline</summary>
  <p className="mt-2 text-sm text-text-2">Download a local review sample: up to 48 saved generated questions and 12 each from homework, ESoft, IMCQ and in-class questions. Unkeyed in-class examples are marked for wording review only. No questions or progress are changed. Figures remain in their original sources.</p>
  <button type="button" disabled={loading || !!error} onClick={()=>downloadQuestionAuditBaseline(buildQuestionAuditBaseline({generated:generated.data,banks:banks.data}))} className="mt-3 rounded border border-border px-3 py-2 text-sm disabled:opacity-40">{loading?"Loading saved questions…":"Download review sample"}</button>
  {!loading && !error && <details className="mt-3 text-sm"><summary className="cursor-pointer">Source availability and exclusions</summary>
   <p className="mt-2 text-text-2">Available text examples are not proof of model use. Figure questions stay in their original banks. Counts include incomplete imports; exclusion reasons may overlap.</p>
   <ul className="mt-2 space-y-2">{kinds.map(kind=>{
    const rows=inventory.filter(row=>row.sourceKind===kind);
    return <li key={kind}><details><summary className="cursor-pointer">{({homework:"Homework",examsoft:"ESoft",imcq:"IMCQ",clicker:"In-class",school:"Other school sources"})[kind]}: {rows.reduce((n,r)=>n+r.textTemplateEligible,0)} text examples available / {rows.reduce((n,r)=>n+r.total,0)} imported</summary>
     {!rows.length && <p className="mt-1 text-text-2">No items classified in this source type in the loaded banks.</p>}
     {rows.map(row=><div key={row.sourceFile} className="mt-2 border-l border-border pl-3"><p>{row.sourceFile}</p><p className="text-xs text-text-2">{row.textTemplateEligible} text eligible · {row.figureDependent} need figures · {row.constructionOnly} wording-only without keys</p>{Object.entries(row.exclusionReasons).map(([reason,count])=><p key={reason} className="text-xs text-text-2">{reason.replaceAll('_',' ')}: {count}</p>)}</div>)}
    </details></li>;
   })}</ul>
  </details>}
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
