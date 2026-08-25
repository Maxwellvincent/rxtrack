/**
 * SP1 T4.4 — every lecture in the block, not just Today's six.
 *
 * Same ranking and the same quick-log path as Today (both go through
 * `useToday`), so the two surfaces can never disagree about urgency or write
 * completion differently.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useToday } from "../today/useToday.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useLectureQuestionStats } from "../../hooks/useLectureQuestionStats.js";
import { ACTIVITY_TYPES, buildLectureRows, lectureCounts, scoreLectures, FILTERS } from "./lectureRows.js";
import { PreReadModal } from "../lectures/PreReadModal.jsx";

const CONFIDENCE = [
  { key: "good", label: "Solid" },
  { key: "okay", label: "OK" },
  { key: "struggling", label: "Shaky" },
];

const SORT_LABELS = { urgency: "priority", date: "date", type: "activity type", lecture: "lecture no.", coverage: "coverage", recent: "recent" };
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

function Row({ row, stats, onStudy, onQuiz, onLog, onUpdateDate, onPreRead, busy, focused, rowRef }) {
  const answered = stats?.answered || 0;
  const accuracy = answered > 0 ? Math.round(((stats?.correct || 0) / answered) * 100) : null;
  const [logging, setLogging] = useState(null);

  return (
    <div
      ref={rowRef}
      className={
        "flex flex-col gap-1.5 border-b border-border py-2 last:border-b-0 transition-colors" +
        (focused ? " -mx-2 rounded bg-accent/10 px-2" : "")
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[12px] text-text-3">
            <span className="rounded bg-panel px-1.5 py-0.5 font-bold text-text-2">{row.type} {row.number ?? ""}</span>
          </span>{" "}
          <span
            className="cursor-pointer text-sm text-text-1 hover:underline"
            onClick={() => onStudy(row.lectureId)}
          >
            {row.studyMode?.icon} {row.title}
          </span>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[12px] text-text-3">
            {row.scheduledToday && <span className="rounded bg-accent/15 px-1.5 py-0.5 font-bold text-accent-text">scheduled today</span>}
            {row.completedToday && <span className="rounded bg-good/10 px-1.5 py-0.5 font-bold text-good">completed today</span>}
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
          {row.topWeakConcepts.length > 0 && (
            <div className="mt-0.5 font-mono text-[12px] text-bad" title="Your weakest concepts tied to this lecture">
              ⚠ review: {row.topWeakConcepts.join(" · ")}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <button onClick={() => setLogging(logging ? null : "review")} className="font-mono text-[12px] text-text-3 hover:text-text-1">
            log
          </button>
          {/* Study leads — see the note in Today.jsx's TaskCard. */}
          {row.preReadOpen && row.sessions === 0 && !row.hasPreRead && (
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

export function LectureList({
  blockId,
  userId,
  onStudyLecture,
  onStartObjectiveQuiz,
  quizBusyLectureId = null,
  onBack,
  focusLectureId = null,
}) {
  const { context, logActivity, logPreRead, objectivesForTask } = useToday(blockId, userId);
  const lecturesResource = useLectures(null, userId);
  const questionStats = useLectureQuestionStats(userId);
  const [filter, setFilter] = useState("active");
  const [activityType, setActivityType] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(readStoredSort);
  const [logged, setLogged] = useState(null);
  const [preReadTarget, setPreReadTarget] = useState(null);
  const [visibleCount, setVisibleCount] = useState(30);

  // Task 12, Part B2 — scroll the focused lecture's row into view and give
  // it a brief highlight on mount. Additive only: with no `focusLectureId`
  // this whole block is inert.
  const focusRowRef = useRef(null);
  const [highlightId, setHighlightId] = useState(focusLectureId ?? null);
  // Adjusting state during render when a prop changes (React's own
  // recommended pattern for this — see "Adjusting state when a prop
  // changes" in the docs) rather than syncing it from an effect, which
  // would call setState synchronously inside the effect body.
  const prevFocusLectureIdRef = useRef(focusLectureId);
  if (prevFocusLectureIdRef.current !== focusLectureId) {
    prevFocusLectureIdRef.current = focusLectureId;
    setHighlightId(focusLectureId ?? null);
  }

  useEffect(() => {
    if (!highlightId) return undefined;
    const timer = setTimeout(() => setHighlightId(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // Scored here rather than taken from the daily schedule: that one stops
  // producing rows once the exam has passed, and the list still has to work.
  const scores = useMemo(() => scoreLectures(context), [context]);

  const rows = useMemo(
    () => buildLectureRows(scores, { completion: context.completion, blockId, filter, activityType, search, sort }),
    [scores, context.completion, blockId, filter, activityType, search, sort]
  );
  const counts = useMemo(
    () => lectureCounts(scores, { completion: context.completion, blockId }),
    [scores, context.completion, blockId]
  );
  const typeCounts = useMemo(() => {
    const all = buildLectureRows(scores, { completion: context.completion, blockId, filter: "all" });
    return Object.fromEntries(ACTIVITY_TYPES.map((type) => [type, type === "all" ? all.length : all.filter((row) => row.type === type).length]));
  }, [scores, context.completion, blockId]);
  const visibleRows = rows.slice(0, visibleCount);

  useEffect(() => setVisibleCount(30), [filter, activityType, search, sort, blockId]);

  // One-shot per focusLectureId value: `rows` is a dependency only so this
  // can wait for the target row to actually be present (e.g. still loading
  // on first mount), not so it re-fires on every unrelated row
  // recomputation (search/filter/sort changes, background activity-log
  // updates) — `scrolledForRef` gates that.
  const scrolledForRef = useRef(null);
  useEffect(() => {
    if (!focusLectureId) return;
    if (scrolledForRef.current === focusLectureId) return;
    if (!rows.some((row) => row.lectureId === focusLectureId)) return;
    scrolledForRef.current = focusLectureId;
    focusRowRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [focusLectureId, rows]);

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
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <button onClick={onBack} className="mb-1 font-mono text-xs text-text-3 hover:text-text-1">← block</button>
          <h2 className="text-lg font-bold text-text-1">Lectures</h2>
          <div className="font-mono text-[12px] text-text-3">{counts.active} active · {counts.done} complete · {counts.all} total</div>
        </div>
        <div className="font-mono text-[12px] text-text-3">showing {Math.min(visibleCount, rows.length)} of {rows.length}</div>
      </div>

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
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-bg-elevated p-2">
        <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-text-3">Activity</span>
        {ACTIVITY_TYPES.filter((type) => type === "all" || typeCounts[type] > 0).map((type) => (
          <button
            key={type}
            onClick={() => setActivityType(type)}
            className={"rounded px-2 py-1 font-mono text-[12px] " + (activityType === type ? "bg-accent text-bg" : "text-text-3 hover:bg-panel hover:text-text-1")}
          >
            {type === "all" ? "All types" : type} ({typeCounts[type]})
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search…"
          className="ml-auto min-w-40 rounded border border-border bg-panel px-2 py-1 text-[13px] text-text-1"
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            if (typeof localStorage !== "undefined") localStorage.setItem(SORT_STORAGE_KEY, e.target.value);
          }}
          className="rounded border border-border bg-panel px-1.5 py-1 font-mono text-[12px] text-text-2"
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
          {visibleRows.map((row) => (
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
              focused={row.lectureId === highlightId}
              rowRef={row.lectureId === focusLectureId ? focusRowRef : undefined}
            />
          ))}
        </div>
      )}
      {visibleCount < rows.length && (
        <button onClick={() => setVisibleCount((n) => n + 30)} className="mt-3 w-full rounded-lg border border-border py-2 font-mono text-[12px] text-text-2 hover:border-accent hover:text-text-1">
          Show 30 more · {rows.length - visibleCount} remaining
        </button>
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
