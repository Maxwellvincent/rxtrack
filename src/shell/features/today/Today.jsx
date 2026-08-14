import { useCallback, useState, useMemo } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useToday } from "./useToday.js";
import * as examDatesStore from "../../../stores/examDates.js";

// ─── Day mode ────────────────────────────────────────────────────────────────

const DAY_MODES = [
  { id: "lecture",  label: "Lecture day",  desc: "Pre-learn AM, lectures, review PM." },
  { id: "review",   label: "Review",       desc: "No lectures. Qs + cumulative review." },
  { id: "triage",   label: "Triage",       desc: "Recover. Less today, essentials only." },
];

function dayModeKey(blockId) { return `rxt-day-mode-${blockId}`; }
function readDayMode(blockId) { return localStorage.getItem(dayModeKey(blockId)) || null; }
function writeDayMode(blockId, mode) { localStorage.setItem(dayModeKey(blockId), mode); }

// ─── Checked + session state (day-scoped per block) ───────────────────────

function checkedKey(blockId) { return `rxt-checked-${blockId}-${new Date().toDateString()}`; }
function readChecked(blockId) {
  try { return new Set(JSON.parse(sessionStorage.getItem(checkedKey(blockId)) || "[]")); }
  catch { return new Set(); }
}
function writeChecked(blockId, set) {
  sessionStorage.setItem(checkedKey(blockId), JSON.stringify([...set]));
}

function sessionsKey(blockId) { return `rxt-rounds-${blockId}-${new Date().toDateString()}`; }
function readSessionCounts(blockId) {
  try { return JSON.parse(sessionStorage.getItem(sessionsKey(blockId)) || "{}"); }
  catch { return {}; }
}
function writeSessionCounts(blockId, map) {
  sessionStorage.setItem(sessionsKey(blockId), JSON.stringify(map));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const MODE_COLORS = { lecture: "#4ade80", review: "#fbbf24", triage: "#f87171" };

function DayModePicker({ mode, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {DAY_MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          className={[
            "flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors",
            mode === m.id
              ? "border-accent bg-panel text-text-1"
              : "border-border bg-bg-elevated text-text-2 hover:border-accent/40",
          ].join(" ")}
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold">
            {mode === m.id && (
              <span
                className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                style={{ background: MODE_COLORS[m.id] }}
              />
            )}
            {m.label}
          </span>
          <span className="mt-0.5 font-mono text-[10px] text-text-3 leading-snug">{m.desc}</span>
        </button>
      ))}
    </div>
  );
}

function ProgressBar({ done, total }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div>
      <div className="flex justify-between font-mono text-[10px] text-text-3 mb-1">
        <span>{done}/{total} done</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: pct === 100
              ? "var(--color-good)"
              : "linear-gradient(90deg, var(--color-accent), var(--color-accent-2, var(--color-accent)))",
          }}
        />
      </div>
    </div>
  );
}

function RoundDots({ done, total }) {
  if (total <= 0) return null;
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={[
            "h-2 w-2 rounded-full transition-colors",
            i < done ? "bg-accent" : "bg-border",
          ].join(" ")}
        />
      ))}
      <span className="ml-1 font-mono text-[10px] text-text-3">{done}/{total}</span>
    </div>
  );
}

function TaskRow({ task, checked, isNext, sessionCount, onCheck, onStudy, onQuiz, onLog, busy }) {
  const [logging, setLogging] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const title = task.lec?.lectureTitle || task.lec?.fileName || task.lec?.filename || "Lecture";
  const recommended = task.recommendedSessions || [];
  const targetRounds = recommended.length;
  const roundsDone = Math.min(sessionCount ?? 0, targetRounds);
  const partiallyDone = roundsDone > 0 && roundsDone < targetRounds;

  return (
    <div
      className={[
        "rounded-lg border transition-colors",
        checked
          ? "border-[var(--color-good,#4ade80)]/40 bg-[var(--color-good,#4ade80)]/5 opacity-70"
          : partiallyDone
            ? "border-accent/50 bg-panel"
            : isNext
              ? "border-accent bg-panel shadow-sm"
              : "border-border bg-bg-elevated hover:border-border-strong",
      ].join(" ")}
    >
      {/* Main row */}
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Checkbox / partial indicator */}
        <button
          onClick={() => onCheck(task.lec.id)}
          className={[
            "mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded border-[1.5px] transition-colors",
            checked
              ? "border-[var(--color-good,#4ade80)] bg-[var(--color-good,#4ade80)] text-bg"
              : partiallyDone
                ? "border-accent bg-accent/20 text-accent"
                : "border-text-3 hover:border-accent",
          ].join(" ")}
          aria-label={checked ? "Mark incomplete" : "Mark complete"}
        >
          {checked
            ? <span className="text-[11px] font-bold leading-none">✓</span>
            : partiallyDone
              ? <span className="text-[10px] font-bold leading-none">~</span>
              : null}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Title + meta — clicking title toggles expanded */}
            <button
              className="min-w-0 text-left"
              onClick={() => setExpanded((e) => !e)}
            >
              {isNext && !checked && (
                <div className="mb-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-accent">
                  Up next
                </div>
              )}
              <div className={["flex items-center gap-1.5 text-[13.5px] font-semibold", checked ? "line-through text-text-3" : "text-text-1"].join(" ")}>
                {task.studyMode?.icon ? `${task.studyMode.icon} ` : ""}{title}
                <span className="text-[10px] text-text-3 font-normal">{expanded ? "▴" : "▾"}</span>
              </div>
              <div className="font-mono text-[10px] text-text-3">
                {task.availableDate
                  ? task.availableDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : task.lec.weekNumber
                    ? `Wk ${task.lec.weekNumber}${task.lec.dayOfWeek ? ` · ${task.lec.dayOfWeek}` : ""}`
                    : null}
                {task.availableDate && " · "}
                {task.matchReason === "scheduled-day"
                  ? "on today's schedule"
                  : task.matchReason === "spaced-rep-due"
                    ? "spaced rep due"
                    : "highest urgency"}
                {task.total > 0 && ` · ${task.mastered}/${task.total} mastered`}
              </div>
            </button>

            {!checked && (
              <div className="flex gap-1.5">
                <Button onClick={() => onStudy(task.lec.id, targetRounds)} title="Study rounds">Study →</Button>
                <Button
                  variant="outline"
                  onClick={() => onQuiz(task)}
                  disabled={busy === task.lec.id}
                >
                  {busy === task.lec.id ? "…" : "Quiz"}
                </Button>
              </div>
            )}
          </div>

          {/* Round progress dots */}
          {!checked && targetRounds > 0 && (
            <RoundDots done={roundsDone} total={targetRounds} />
          )}

          {/* Log row */}
          {!checked && (
            <div className="flex flex-wrap items-center gap-2">
              {logging ? (
                <>
                  <span className="font-mono text-[10px] text-text-3">how did {logging} go?</span>
                  {[{ key: "good", label: "Solid" }, { key: "okay", label: "OK" }, { key: "struggling", label: "Shaky" }].map((c) => (
                    <button
                      key={c.key}
                      onClick={() => { onLog(task.lec.id, logging, c.key); setLogging(null); }}
                      className="rounded border border-border px-2 py-0.5 text-[11px] text-text-2 hover:text-text-1"
                    >
                      {c.label}
                    </button>
                  ))}
                  <button onClick={() => setLogging(null)} className="font-mono text-[10px] text-text-3 hover:text-text-1">✕</button>
                </>
              ) : (
                <>
                  <button onClick={() => setLogging("anki")} className="font-mono text-[10px] text-text-3 hover:text-text-1">📇 log anki</button>
                  <button onClick={() => setLogging("review")} className="font-mono text-[10px] text-text-3 hover:text-text-1">✓ log review</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-3">
          {/* Objectives breakdown */}
          {task.total > 0 && (
            <div>
              <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-text-3">Objectives</div>
              <div className="flex gap-3 font-mono text-[11px]">
                {task.mastered > 0 && <span className="text-good">✓ {task.mastered} mastered</span>}
                {task.struggling > 0 && <span className="text-warn">⚠ {task.struggling} struggling</span>}
                {task.untested > 0 && <span className="text-text-3">· {task.untested} untested</span>}
              </div>
            </div>
          )}

          {/* Recommended sessions for today */}
          {recommended.length > 0 && (
            <div>
              <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-text-3">Today's sessions</div>
              <div className="flex flex-col gap-1">
                {recommended.map((s, i) => (
                  <div key={i} className={["flex items-start gap-2 font-mono text-[11px]", i < roundsDone ? "text-text-3 line-through" : "text-text-2"].join(" ")}>
                    <span className="mt-px text-[9px] text-text-3 flex-shrink-0">{i + 1}.</span>
                    <div>
                      <span>{s.label}</span>
                      {s.reason && <span className="ml-1.5 text-[10px] text-text-3">— {s.reason}</span>}
                      {s.duration && <span className="ml-1.5 text-[9px] text-text-3">~{s.duration}m</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sessions done lifetime + confidence */}
          <div className="flex gap-4 font-mono text-[10px] text-text-3">
            {task.sessions > 0 && <span>{task.sessions} session{task.sessions !== 1 ? "s" : ""} total</span>}
            {task.confidence && task.confidence !== "Low" && <span>confidence: {task.confidence.toLowerCase()}</span>}
            {task.lastScore != null && <span>last score: {task.lastScore}%</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Exam date picker (shown when no date set) ────────────────────────────────

function ExamDatePicker({ blockId, userId }) {
  const [dateInput, setDateInput] = useState("");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!dateInput) return;
    setSaving(true);
    try {
      const current = examDatesStore.read(userId) || {};
      await examDatesStore.write(userId, { ...current, [blockId]: dateInput });
    } finally {
      setSaving(false);
    }
  }, [blockId, userId, dateInput]);

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-4">
      <div className="mb-1 text-sm font-semibold text-text-1">Set exam date</div>
      <div className="mb-3 font-mono text-[10px] text-text-3">
        Today plans backwards from the exam — set a date to see your schedule.
      </div>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          className="rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-text-1 focus:outline-none focus:border-border-strong"
        />
        <Button onClick={save} disabled={!dateInput || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Today component ─────────────────────────────────────────────────────

export function Today({ blockId, userId, onStudyLecture, onStartObjectiveQuiz, quizBusyLectureId = null }) {
  const { todayTasks, todayReason, nextDay, daily, study, examDate, daysLeft, logActivity, objectivesForTask } =
    useToday(blockId, userId);

  const [dayMode, setDayMode] = useState(() => readDayMode(blockId));
  const [checked, setChecked] = useState(() => readChecked(blockId));
  const [sessionCounts, setSessionCounts] = useState(() => readSessionCounts(blockId));
  const [logFeedback, setLogFeedback] = useState(null);

  const handleDayMode = useCallback((m) => {
    setDayMode(m);
    writeDayMode(blockId, m);
  }, [blockId]);

  const handleCheck = useCallback((id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      writeChecked(blockId, next);
      return next;
    });
  }, [blockId]);

  const onLog = useCallback((lectureId, activityType, confidenceRating) => {
    const entry = logActivity({ lectureId, activityType, confidenceRating });
    setLogFeedback(entry ? `Logged — next review ${entry.reviewDates?.[0] ?? "scheduled"}` : "Could not log.");
    // Auto-check on log
    setChecked((prev) => {
      const next = new Set(prev);
      next.add(lectureId);
      writeChecked(blockId, next);
      return next;
    });
    setTimeout(() => setLogFeedback(null), 4000);
  }, [logActivity, blockId]);

  const onStudy = useCallback((id, targetRounds) => {
    onStudyLecture?.(id);
    setSessionCounts((prev) => {
      const newCount = (prev[id] ?? 0) + 1;
      const next = { ...prev, [id]: newCount };
      writeSessionCounts(blockId, next);
      // Auto-check only when all recommended rounds are done
      if (newCount >= (targetRounds || 1)) {
        setChecked((c) => {
          const ns = new Set(c);
          ns.add(id);
          writeChecked(blockId, ns);
          return ns;
        });
      }
      return next;
    });
  }, [onStudyLecture, blockId]);

  const onQuiz = useCallback((task) => {
    const objectives = objectivesForTask(task.lec.id);
    const title = task.lec?.lectureTitle || task.lec?.fileName || "Lecture";
    onStartObjectiveQuiz?.(objectives, title, blockId, { lectureId: task.lec.id });
  }, [objectivesForTask, onStartObjectiveQuiz, blockId]);

  // Day mode filters the raw task list without touching the scheduler
  const filteredTasks = useMemo(() => {
    if (!dayMode) return todayTasks;
    if (dayMode === "lecture") {
      // Prioritise scheduled-day; allow up to 2 spaced-rep-due on top; skip pure urgency fill
      const scheduled = todayTasks.filter((t) => t.matchReason === "scheduled-day");
      const due = todayTasks.filter((t) => t.matchReason === "spaced-rep-due").slice(0, 2);
      return [...scheduled, ...due];
    }
    if (dayMode === "review") {
      // No new scheduled lectures — review overdue + highest urgency old material only
      return todayTasks
        .filter((t) => t.matchReason !== "scheduled-day")
        .slice(0, 5);
    }
    if (dayMode === "triage") {
      // Recovery: 2 highest-urgency tasks only, prefer ones already seen (sessions > 0)
      const seen = todayTasks.filter((t) => (t.sessions ?? 0) > 0);
      const pool = seen.length >= 2 ? seen : todayTasks;
      return pool.slice(0, 2);
    }
    return todayTasks;
  }, [dayMode, todayTasks]);

  const doneCount = useMemo(() => filteredTasks.filter((t) => checked.has(t.lec.id)).length, [filteredTasks, checked]);
  const firstUnchecked = useMemo(() => filteredTasks.find((t) => !checked.has(t.lec.id))?.lec.id ?? null, [filteredTasks, checked]);

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  if (!examDate) {
    return <ExamDatePicker blockId={blockId} userId={userId} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] text-text-3">{dateStr}</div>
          <h2 className="text-lg font-bold text-text-1">Daily Plan</h2>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full border border-border bg-panel px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-text-2">
            {dayMode
              ? <><span className="inline-block mr-1.5 h-2 w-2 rounded-full align-middle" style={{ background: MODE_COLORS[dayMode] }} />{DAY_MODES.find((m) => m.id === dayMode)?.label}</>
              : "Pick a day type"
            }
          </span>
          <span className="font-mono text-[10px] text-text-3">{daysLeft}d to exam</span>
        </div>
      </div>

      {/* Day mode picker */}
      <DayModePicker mode={dayMode} onChange={handleDayMode} />

      {/* Progress */}
      {filteredTasks.length > 0 && (
        <ProgressBar done={doneCount} total={filteredTasks.length} />
      )}

      {logFeedback && (
        <div className="font-mono text-[10px] text-good">{logFeedback}</div>
      )}

      {/* Urgency fallback notice */}
      {todayReason === "urgency-fallback" && nextDay && (
        <div className="font-mono text-[10px] text-text-3">
          Nothing scheduled today — next session {nextDay.dateStr} ({nextDay.daysFromNow}d). Showing highest-urgency:
        </div>
      )}

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        todayTasks.length > 0 && dayMode ? (
          <div className="rounded-lg border border-border p-4 text-xs text-text-3">
            No tasks match <span className="text-text-1">{DAY_MODES.find((m) => m.id === dayMode)?.label}</span> today.
            {dayMode === "review" && " All available lectures are scheduled for today — switch to Lecture day."}
            {dayMode === "triage" && " No previously-studied lectures available — showing top pick below."}
          </div>
        ) : nextDay ? (
          <div className="rounded-lg border border-border p-4 text-xs text-text-3">
            Nothing due today. Block starts{" "}
            <span className="text-text-1">{nextDay.dateStr}</span> — {nextDay.daysFromNow} days away,{" "}
            {nextDay.tasks.length} lecture{nextDay.tasks.length === 1 ? "" : "s"}.
            <div className="mt-2 flex flex-col gap-0.5">
              {nextDay.tasks.slice(0, 4).map((t) => (
                <span key={t.lec.id} className="font-mono text-[10px]">
                  {t.studyMode?.icon} {t.lec.lectureTitle || t.lec.fileName || t.lec.filename}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border p-4 text-xs text-text-3">
            Nothing to do — every lecture is mastered or not yet available.
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {filteredTasks.map((task) => (
            <TaskRow
              key={task.lec.id}
              task={task}
              checked={checked.has(task.lec.id)}
              isNext={task.lec.id === firstUnchecked}
              sessionCount={sessionCounts[task.lec.id] ?? 0}
              onCheck={handleCheck}
              onStudy={onStudy}
              onQuiz={onQuiz}
              onLog={onLog}
              busy={quizBusyLectureId}
            />
          ))}
        </div>
      )}

      {/* Reset */}
      {doneCount > 0 && (
        <button
          onClick={() => { setChecked(new Set()); writeChecked(blockId, new Set()); }}
          className="self-start font-mono text-[10px] text-text-3 hover:text-text-1"
        >
          Reset checks
        </button>
      )}
    </div>
  );
}

export default Today;
