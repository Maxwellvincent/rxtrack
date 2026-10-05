/** The conversation carries the teaching; diagnostic metadata stays inspectable. */
export function TutorMessage({ turn }) {
  const hasNotes = turn.preservedReasoning?.length || turn.firstDivergence || turn.missTypes?.length || turn.confidenceNote;
  return <div className="desk-tutor-bubble desk-tutor-bubble--tutor">
    <span className="desk-tutor-bubble__label">Tutor</span>
    <p>{turn.feedback}</p>
    {turn.followUp && <p className="desk-tutor-bubble__question">{turn.followUp}</p>}
    {hasNotes ? <details className="mt-3 text-xs leading-5 text-text-2">
      <summary className="cursor-pointer text-text-3">Reasoning notes</summary>
      {turn.assessment && <p className="mt-2">Assessment: {turn.assessment.replace(/_/g, " ")}</p>}
      {turn.preservedReasoning?.length > 0 && <p className="mt-1"><strong>What you got right:</strong> {turn.preservedReasoning.join(" · ")}</p>}
      {turn.firstDivergence && <p className="mt-1"><strong>Connection to strengthen:</strong> {turn.firstDivergence}</p>}
      {turn.missTypes?.length > 0 && <p className="mt-1"><strong>Practice category:</strong> {turn.missTypes.join(" + ")}</p>}
      {turn.confidenceNote && <p className="mt-1">{turn.confidenceNote}</p>}
    </details> : null}
    {turn.ankiRecommendation && <details className="mt-3 rounded border border-accent/30 p-2 text-xs leading-5 text-text-2">
      <summary className="cursor-pointer font-semibold">Targeted card draft</summary>
      <p className="mt-2">{turn.ankiRecommendation.front}</p>
      <p className="mt-1"><strong>Back:</strong> {turn.ankiRecommendation.back}</p>
      <button type="button" className="mt-2 rounded border border-accent/40 px-2 py-1 font-semibold text-accent" onClick={() => navigator.clipboard?.writeText(`${turn.ankiRecommendation.front}\n\n${turn.ankiRecommendation.back}`)}>Copy card draft</button>
    </details>}
  </div>;
}
