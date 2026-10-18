export function ExamPreparationStatus({ session }) {
  const ready = session.questions?.length || 0;
  return <p role="status" aria-live="polite" className="text-sm text-text-3">{ready ? "More questions are preparing in the background." : "Preparing your first questions…"}</p>;
}
