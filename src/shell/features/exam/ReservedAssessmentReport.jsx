import {reservedAssessmentResults} from '../../../engine/reservedAssessment.js';
export function ReservedAssessmentReport({session,excludedIds=[],objectivesById={},lectureLabelsByLectureId={}}){
 if(session.purpose!=='reserved-assessment' || session.status!=='submitted')return null;
 const result=reservedAssessmentResults(session,excludedIds);
 const label=(id,kind)=>id==='unlinked'?'No confirmed link':kind==='lecture'?lectureLabelsByLectureId[id] || id
  : objectivesById[id]?.objective || objectivesById[id]?.text || objectivesById[id]?.code || id;
 return <section aria-label="Reserved assessment result" className="rounded-xl border border-accent/40 bg-panel p-4">
  <h3 className="font-semibold">Reserved assessment · {result.percent==null?'No scoreable items':`${result.percent}%`}</h3>
  <p className="mt-1 text-sm">{result.correct}/{result.total} correct · {result.incorrect} wrong · {result.unanswered} unanswered counted in the score{result.excluded?` · ${result.excluded} quality exclusions`:''}.</p>
  <p className="mt-2 text-xs text-text-2">{session.assessment?.knownPriorExposure || 0} questions had recorded prior exposure; {session.assessment?.unknownPriorExposure ?? result.total} have unknown earlier exposure. Delivery attempts are counted conservatively, even after an interrupted launch. Exact-content matching does not detect all paraphrases or outside study. This is a descriptive assessment, not a predicted school score.</p>
  <h4 className="mt-3 text-sm font-semibold">Where to focus</h4>
  <ul className="mt-2 space-y-1 text-sm">{result.lectures.map(row=><li key={row.id}>{label(row.id,'lecture')} · {row.percent}% ({row.correct}/{row.total}){row.unanswered?` · ${row.unanswered} unanswered`:''}</li>)}</ul>
  <details className="mt-3 text-sm"><summary className="cursor-pointer">Objective results</summary><ul className="mt-2 space-y-2">{result.objectives.map(row=><li key={row.id}>{label(row.id,'objective')} · {row.percent}% ({row.correct}/{row.total})</li>)}</ul><p className="mt-2 text-xs text-text-3">A question may link to more than one objective; these rows must not be added together. Small samples identify review targets, not mastery.</p></details>
 </section>;
}

/** Use the frozen exhibit from launch; do not offer answer-bearing PDF pages or editing tools. */
export function ReservedAssessmentFigure({question}){
 if(!question.sourceFigureCropped || !question.sourceImageUrl)return null;
 return <figure className="my-3"><img src={question.sourceImageUrl} alt="Assessment exhibit" className="max-h-[75vh] max-w-full rounded border border-border"/><figcaption className="mt-1 text-xs text-text-3">Saved assessment exhibit</figcaption></figure>;
}
