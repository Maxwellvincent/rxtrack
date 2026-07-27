/**
 * SP1 T4.3 — Today, on the hooks and the pure schedulers.
 *
 * Every action here is the real path, not a stub: the quiz launches through the
 * same generator the objectives view uses, "Study" opens the lecture flow that
 * extracts and quizzes atoms, and logging writes to the completion store the
 * schedulers read back for urgency.
 */
import { useCallback, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useToday } from "./useToday.js";

const CONFIDENCE = [
  { key: "good", label: "Solid" },
  { key: "okay", label: "OK" },
  { key: "struggling", label: "Shaky" },
];

function TaskCard({ task, onQuiz, onStudy, onLog, busy }) {
  const [logging, setLogging] = useState(null); // null | "anki" | "review"
  const mode = task.studyMode;
  const title = task.lec?.lectureTitle || task.lec?.fileName || task.lec?.filename || "Lecture";

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-1">
            {mode?.icon ? `${mode.icon} ` : ""}{title}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-text-3">
            {task.matchReason === "scheduled-day"
              ? "on today's timetable"
              : task.matchReason === "spaced-rep-due"
                ? "spaced repetition due"
                : "highest urgency"}
            {" · "}urgency {Math.round(task.urgency)}
            {task.total > 0 && ` · ${task.mastered}/${task.total} mastered`}
            {task.struggling > 0 && ` · ${task.struggling} struggling`}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" onClick={() => onStudy(task.lec.id)}>Study</Button>
          <Button onClick={() => onQuiz(task)} disabled={busy === task.lec.id}>
            {busy === task.lec.id ? "Generating…" : "Quiz"}
          </Button>
        </div>
      </div>

      {task.recommendedSessions?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.recommendedSessions.map((s, i) => (
            <span key={i} title={s.reason} className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-text-3">
              {s.label} · {s.duration}m
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {logging ? (
          <>
            <span className="font-mono text-[10px] text-text-3">how did the {logging} go?</span>
            {CONFIDENCE.map((c) => (
              <button
                key={c.key}
                onClick={() => { onLog(task.lec.id, logging, c.key); setLogging(null); }}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-text-2 hover:text-text-1"
              >
                {c.label}
              </button>
            ))}
            <button onClick={() => setLogging(null)} className="font-mono text-[10px] text-text-3 hover:text-text-1">
              cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setLogging("anki")} className="font-mono text-[10px] text-text-3 hover:text-text-1">
              📇 log anki
            </button>
            <button onClick={() => setLogging("review")} className="font-mono text-[10px] text-text-3 hover:text-text-1">
              ✓ log review
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Today({ blockId, userId, onStudyLecture, onStartObjectiveQuiz, quizBusyLectureId = null }) {
  const { todayTasks, daily, study, examDate, daysLeft, logActivity, objectivesForTask } = useToday(blockId, userId);
  const [logged, setLogged] = useState(null);

  const onLog = useCallback(
    (lectureId, activityType, confidenceRating) => {
      const entry = logActivity({ lectureId, activityType, confidenceRating });
      setLogged(entry ? `Logged — next review ${entry.reviewDates?.[0] ?? "scheduled"}` : "Could not log that.");
    },
    [logActivity]
  );

  const onQuiz = useCallback(
    (task) => {
      const objectives = objectivesForTask(task.lec.id);
      const title = task.lec?.lectureTitle || task.lec?.fileName || "Lecture";
      onStartObjectiveQuiz?.(objectives, title, blockId, { lectureId: task.lec.id });
    },
    [objectivesForTask, onStartObjectiveQuiz, blockId]
  );

  if (!examDate) {
    return (
      <div className="text-xs text-text-3">
        No exam date on this block yet — Today plans backwards from the exam, so set one to see a schedule.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-text-1">Today</h2>
        <span className="font-mono text-[10px] text-text-3">
          {daysLeft} days to exam · {study?.totalSessions ?? 0} sessions planned
        </span>
      </div>

      {logged && <div className="mb-2 font-mono text-[10px] text-good">{logged}</div>}

      {todayTasks.length === 0 ? (
        <div className="rounded-lg border border-border p-3 text-xs text-text-3">
          Nothing scheduled for today.
          {daily?.lecScores?.length > 0 && daily.schedule.length === 0 && (
            <>
              {" "}All {daily.lecScores.length} lectures in this block are undated, and the day planner only places
              lectures that have a date — add dates or a block start to see them here.
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {todayTasks.map((task) => (
            <TaskCard
              key={task.lec.id}
              task={task}
              busy={quizBusyLectureId}
              onQuiz={onQuiz}
              onStudy={onStudyLecture}
              onLog={onLog}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default Today;
