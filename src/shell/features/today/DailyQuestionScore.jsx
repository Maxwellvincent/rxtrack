import { studyDayRange } from "../../../studyDay.js";
import {useQuestionPractice} from "../../hooks/useQuestionPractice.js";
import { questionProgress } from "../exam/questionProgress.js";

export function DailyQuestionScore({ userId, blockId }) {
  const {studyAnswers,sessions,manualEntries,loading,error}=useQuestionPractice(userId,blockId);
  const today = studyDayRange(new Date(), userId);

  const progress = questionProgress(studyAnswers, sessions, today, manualEntries);
  const accuracy = progress.accuracy == null ? null : Math.round(progress.accuracy * 100);
  const atTarget = accuracy != null && accuracy >= 80;

  return <section aria-label="Daily question score" className="rounded-xl border border-border bg-bg-elevated p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold text-text-1">Today’s question score</h3>
        <p className="mt-1 text-sm text-text-2">{loading ? "Loading today’s graded answers…" : error ? "Could not load today’s exam results." : accuracy == null ? "No scored answers recorded for this study day yet." : `${progress.gradedAnswered} graded question${progress.gradedAnswered === 1 ? "" : "s"} · ${progress.correct} correct · ${accuracy}% average`}</p>
      </div>
      <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${atTarget ? "border-good/40 bg-good/10 text-good" : "border-border bg-panel text-text-2"}`}>
        {atTarget ? "80% goal reached" : "Daily target · 80%"}
      </div>
    </div>
    <p className="mt-2 text-xs text-text-3">{progress.gradedAnswered-progress.correct} wrong · {progress.answered} questions completed · {progress.manualAnswered} self-reported outside RXTrack. Scores do not grant objective coverage.</p>
    {accuracy != null && <>
      <progress className={`mt-3 h-3 w-full accent-accent ${atTarget ? "[&::-webkit-progress-value]:bg-good" : ""}`} max={100} value={accuracy} aria-label={`Daily accuracy ${accuracy}%`} />
      <p className="mt-1 text-xs text-text-3">{atTarget ? "You’re at or above your success target for today." : `${80 - accuracy} percentage points to today’s target. Saved homework, retakes and scored outside practice count.`}</p>
    </>}
    {accuracy == null && <p className="mt-2 text-xs text-text-3">Saved homework and quiz retakes count. Outside practice counts toward accuracy when correct answers are entered; count-only logs add volume.</p>}
  </section>;
}
