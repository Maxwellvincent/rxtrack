/**
 * SP1 T4.4 — every lecture in the block, not just Today's six.
 *
 * Same ranking and the same quick-log path as Today (both go through
 * `useToday`), so the two surfaces can never disagree about urgency or write
 * completion differently.
 */
import { useCallback, useMemo, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useToday } from "../today/useToday.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useLectureQuestionStats } from "../../hooks/useLectureQuestionStats.js";
import { buildLectureRows, lectureCounts, scoreLectures, FILTERS } from "./lectureRows.js";
import { PreReadModal } from "../lectures/PreReadModal.jsx";

const CONFIDENCE = [
  { key: "good", label: "Solid" },
  { key: "okay", label: "OK" },
  { key: "struggling", label: "Shaky" },
];

const SORT_LABELS = { urgency: "urgency", lecture: "lecture no.", coverage: "coverage", recent: "recent" };
const SORT_STORAGE_KEY = "rxt-lecture-list-sort";

function readStoredSort() {
  if (typeof localStorage === "undefined") return "urgency";
  const stored = localStorage.getItem(SORT_STORAGE_KEY);
  return stored && SORT_LABELS[stored] ? stored : "urgency";
}

function DateEdit({ row, onUpdateDate }) {
  const [editing, setEditing] = useState(false);
  const dateVal = row.availableDate instanceof Date && !isNaN(row.availableDate)
    ? row.availableDate.toISOString().slice(0, 10)
    : "";

  const commit = (val) => {
    onUpdateDate(row.lectureId, val || null);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="date"
        defaultValue={dateVal}
        autoFocus
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.target.value);
          if (e.key === "Escape") setEditing(false);
        }}
        className="rounded border border-accent bg-bg px-1 py-0 font-mono text-[12px] text-text-1 focus:outline-none"
      />
    );
  }

  const label = row.availableDate instanceof Date && !isNaN(row.availableDate)
    ? row.availableDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : row.weekNumber
      ? `Wk ${row.weekNumber}${row.dayOfWeek ? ` · ${row.dayOfWeek}` : ""}`
      : "set date";

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to edit date"
      className="font-mono text-[12px] text-text-3 hover:text-accent"
    >
      {label} <span className="opacity-50">✎</span>
    </button>
  );
}

function Row({ row, stats, onStudy, onQuiz, onLog, onUpdateDate, onPreRead, busy }) {
  const answered = stats?.answered || 0;
  const accuracy = answered > 0 ? Math.round(((stats?.correct || 0) / answered) * 100) : null;
  const [logging, setLogging] = useState(null);

  return (
    <div className="flex flex-col gap-1.5 border-b border-border py-2 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[12px] text-text-3">
            {row.type} {row.number ?? ""}
          </span>{" "}
          <span
            className="cursor-pointer text-sm text-text-1 hover:underline"
            onClick={() => onStudy(row.lectureId)}
          >
            {row.studyMode?.icon} {row.title}
          </span>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[12px] text-text-3">
            <DateEdit row={row} onUpdateDate={onUpdateDate} />
            <span>·</span>
            {row.total > 0 ? `${row.mastered}/${row.total} mastered` : "no objectives linked"}
            {row.struggling > 0 && ` · ${row.struggling} struggling`}
            {row.sessions > 0
              ? ` · ${row.sessions} session${row.sessions > 1 ? "s" : ""}`
              : row.hasPreRead
                ? " · pre-read only"
                : " · never studied"}
            {/* Sessions count visits; this counts work. A lecture opened four times and answered
                twice looks busy by sessions alone, and that is exactly the one to re-drill. */}
            {answered > 0 && (
              <span title={`${stats.correct} of ${answered} correct`}>
                {` · ${answered} q`}
                <span className={accuracy >= 85 ? "text-good" : accuracy >= 70 ? "text-accent" : "text-bad"}>
                  {` ${accuracy}%`}
                </span>
              </span>
            )}
            {row.lastActivityDate && ` · last ${row.lastActivityDate}`}
            {row.nextReview && ` · review ${row.nextReview}`}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <button onClick={() => setLogging(logging ? null : "review")} className="font-mono text-[12px] text-text-3 hover:text-text-1">
            log
          </button>
          {/* Study leads — see the note in Today.jsx's TaskCard. */}
          {(row.hasNoDate || row.isFuture) && row.sessions === 0 && !row.hasPreRead && (
            <Button
              variant="outline"
              onClick={() => onPreRead(row)}
              title="Five prediction questions before you study — surfaces what you don't know yet."
            >
              Pre-read
            </Button>
          )}
          <Button
            onClick={() => onStudy(row.lectureId)}
            title="Work through this lecture in rounds of five. Remembers where you stopped."
          >
            Study →
          </Button>
          <Button
            variant="outline"
            onClick={() => onQuiz(row)}
            disabled={busy === row.lectureId}
            title="One-off questions across this lecture's objectives. No rounds, no resume."
          >
            {busy === row.lectureId ? "Generating…" : "Quiz"}
          </Button>
        </div>
      </div>

      {logging && (
        <div className="flex flex-wrap items-center gap-2">
          {["review", "anki", "questions"].map((type) => (
            <button
              key={type}
              onClick={() => setLogging(type)}
              className={
                "rounded border px-2 py-0.5 text-[13px] " +
                (logging === type ? "border-accent text-text-1" : "border-border text-text-3")
              }
            >
              {type}
            </button>
          ))}
          <span className="font-mono text-[12px] text-text-3">how did it go?</span>
          {CONFIDENCE.map((c) => (
            <button
              key={c.key}
              onClick={() => { onLog(row.lectureId, logging, c.key); setLogging(null); }}
              className="rounded border border-border px-2 py-0.5 text-[13px] text-text-2 hover:text-text-1"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LectureList({ blockId, userId, onStudyLecture, onStartObjectiveQuiz, quizBusyLectureId = null, onBack }) {
  const { context, logActivity, logPreRead, objectivesForTask } = useToday(blockId, userId);
  const lecturesResource = useLectures(null, userId);
  const questionStats = useLectureQuestionStats(userId);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(readStoredSort);
  const [logged, setLogged] = useState(null);
  const [preReadTarget, setPreReadTarget] = useState(null);

  // Scored here rather than taken from the daily schedule: that one stops
  // producing rows once the exam has passed, and the list still has to work.
  const scores = useMemo(() => scoreLectures(context), [context]);

  const rows = useMemo(
    () => buildLectureRows(scores, { completion: context.completion, blockId, filter, search, sort }),
    [scores, context.completion, blockId, filter, search, sort]
  );
  const counts = useMemo(
    () => lectureCounts(scores, { completion: context.completion, blockId }),
    [scores, context.completion, blockId]
  );

  const onLog = useCallback(
    (lectureId, activityType, confidenceRating) => {
      const entry = logActivity({ lectureId, activityType, confidenceRating });
      setLogged(entry ? `Logged ${activityType} — next review ${entry.reviewDates?.[0] ?? "scheduled"}` : "Could not log that.");
    },
    [logActivity]
  );

  const onQuiz = useCallback(
    (row) => {
      onStartObjectiveQuiz?.(objectivesForTask(row.lectureId), row.title, blockId, { lectureId: row.lectureId });
    },
    [objectivesForTask, onStartObjectiveQuiz, blockId]
  );

  const onUpdateDate = useCallback(
    (lectureId, dateStr) => {
      const all = lecturesResource.data || [];
      const next = all.map((lec) =>
        lec.id === lectureId ? { ...lec, lectureDate: dateStr || null } : lec
      );
      lecturesResource.mutate(next);
    },
    [lecturesResource]
  );

  return (
    <div className="p-5">
      <button onClick={onBack} className="mb-3 font-mono text-xs text-text-3 hover:text-text-1">← block</button>
      <h2 className="text-sm font-bold text-text-1">Lectures</h2>
      <div className="mb-3 font-mono text-[12px] text-text-3">{counts.all} in this block</div>

      {logged && <div className="mb-2 font-mono text-[12px] text-good">{logged}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              "rounded border px-2 py-0.5 font-mono text-[12px] " +
              (filter === f ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")
            }
          >
            {f} {counts[f] != null ? `(${counts[f]})` : ""}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search…"
          className="ml-auto rounded border border-border bg-panel px-2 py-0.5 text-[13px] text-text-1"
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            if (typeof localStorage !== "undefined") localStorage.setItem(SORT_STORAGE_KEY, e.target.value);
          }}
          className="rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[12px] text-text-2"
        >
          {Object.entries(SORT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border p-3 text-xs text-text-3">Nothing matches that filter.</div>
      ) : (
        <div className="rounded-lg border border-border px-3">
          {rows.map((row) => (
            <Row
              key={row.lectureId}
              row={row}
              stats={questionStats.data?.[row.lectureId]}
              busy={quizBusyLectureId}
              onStudy={onStudyLecture}
              onQuiz={onQuiz}
              onLog={onLog}
              onUpdateDate={onUpdateDate}
              onPreRead={setPreReadTarget}
            />
          ))}
        </div>
      )}

      {preReadTarget && (
        <PreReadModal
          lecture={preReadTarget.lec}
          objectives={objectivesForTask(preReadTarget.lectureId)}
          onClose={() => setPreReadTarget(null)}
          onComplete={({ lectureId, gapObjectiveIds, durationMinutes }) => {
            logPreRead({ lectureId, gapObjectiveIds, durationMinutes });
            setPreReadTarget(null);
          }}
        />
      )}
    </div>
  );
}

export default LectureList;
