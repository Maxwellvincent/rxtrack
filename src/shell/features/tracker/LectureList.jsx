/**
 * SP1 T4.4 — every lecture in the block, not just Today's six.
 *
 * Same ranking and the same quick-log path as Today (both go through
 * `useToday`), so the two surfaces can never disagree about urgency or write
 * completion differently.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import * as atomProgressStore from "../../../stores/atomProgress.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { RenameLecture } from "../lectures/RenameLecture.jsx";
import { useToday } from "../today/useToday.js";
import { useLectureQuestionStats } from "../../hooks/useLectureQuestionStats.js";
import { ACTIVITY_TYPES, buildLectureRows, lectureCounts, scoreLectures, FILTERS } from "./lectureRows.js";
import { PreReadModal } from "../lectures/PreReadModal.jsx";
import { deleteLectureFully, deleteLecturesFully } from "../../logic/deleteLecture.js";
import { updateLectureDate } from "../../logic/lectureDate.js";
import { localDateString } from "../../logic/completionLog.js";
import { buildLectureWeeks, rowMatchesWeek } from "./lectureWeeks.js";

const CONFIDENCE = [
  { key: "good", label: "Solid" },
  { key: "okay", label: "OK" },
  { key: "struggling", label: "Shaky" },
];

const SORT_LABELS = { repairs: "most model repairs", urgency: "priority", date: "date", type: "activity type", lecture: "lecture no.", coverage: "coverage", recent: "recent" };
const FILTERS_STORAGE_KEY = "rxt-lecture-list-prefs";

function filterPrefsKey(blockId) { return `${FILTERS_STORAGE_KEY}:${blockId || "default"}`; }

function readFilterPrefs(blockId) {
  const defaults = { filter: "active", activityType: "all", search: "", sort: "urgency", week: "all", showAllLectures: false };
  try {
    if (typeof localStorage === "undefined") return defaults;
    const saved = JSON.parse(localStorage.getItem(filterPrefsKey(blockId)) || "{}");
    return {
      filter: FILTERS.includes(saved.filter) ? saved.filter : defaults.filter,
      activityType: ACTIVITY_TYPES.includes(saved.activityType) ? saved.activityType : defaults.activityType,
      search: typeof saved.search === "string" ? saved.search : defaults.search,
      sort: SORT_LABELS[saved.sort] ? saved.sort : defaults.sort,
      week: typeof saved.week === "string" ? saved.week : defaults.week,
      showAllLectures: typeof saved.showAllLectures === "boolean" ? saved.showAllLectures : defaults.showAllLectures,
    };
  } catch { return defaults; }
}

function saveFilterPrefs(blockId, patch) {
  try {
    if (typeof localStorage === "undefined") return;
    const current = readFilterPrefs(blockId);
    localStorage.setItem(filterPrefsKey(blockId), JSON.stringify({ ...current, ...patch }));
  } catch { /* filters remain usable even when browser storage is full */ }
}

function DateEdit({ row, onUpdateDate }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dateVal = row.availableDate instanceof Date && !isNaN(row.availableDate)
    ? localDateString(row.availableDate)
    : "";

  const commit = async (val) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await onUpdateDate(row.lectureId, val || null);
      if (saved) setEditing(false);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        type="date"
        defaultValue={dateVal}
        autoFocus
        disabled={saving}
        onBlur={(e) => { if (!saving) void commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void commit(e.target.value); }
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

function Row({ row, userId, stats, onStudy, onQuiz, onLog, onUpdateDate, onPreRead, onDelete, busy, deleting, focused, rowRef, selectable = false, selected = false, onToggleSelected }) {
  const answered = stats?.answered || 0;
  const accuracy = answered > 0 ? Math.round(((stats?.correct || 0) / answered) * 100) : null;
  const [logging, setLogging] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      ref={rowRef}
      className={
        "desk-lecture-row flex flex-col gap-1.5 border-b border-border py-2 last:border-b-0 transition-colors" +
        (focused ? " -mx-2 rounded bg-accent/10 px-2" : "")
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {selectable && <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(row.lectureId)}
            aria-label={`Select ${row.title}`}
            className="mt-1 h-4 w-4 shrink-0 accent-accent"
          />}
        <div className="min-w-0">
          <span className="font-mono text-[12px] text-text-3">
            <span className="rounded bg-panel px-1.5 py-0.5 font-bold text-text-2">{row.type} {row.number ?? ""}</span>
          </span>{" "}
          <button
            className="cursor-pointer text-sm text-text-1 hover:underline"
            onClick={() => onStudy(row.lectureId)}
          >
            {row.studyMode?.icon} {row.title}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[12px] text-text-3">
            {row.scheduledToday && <span className="rounded bg-accent/15 px-1.5 py-0.5 font-bold text-accent-text">scheduled today</span>}
            {row.completedToday && <span className="rounded bg-good/10 px-1.5 py-0.5 font-bold text-good">studied today</span>}
            <span className="desk-lecture-stat">{row.total > 0 ? `${row.mastered}/${row.total} objectives` : "No objectives linked"}</span>
            {row.struggling > 0 && <span className="desk-lecture-stat desk-lecture-stat--warn">{row.struggling} struggling</span>}
            {answered > 0 && <span className="desk-lecture-stat" title={`${stats.correct} of ${answered} correct`}>{answered} questions · <span className={accuracy >= 85 ? "text-good" : accuracy >= 70 ? "text-accent" : "text-bad"}>{accuracy}%</span></span>}
            {!answered && <span className="desk-lecture-stat">{row.sessions > 0 ? `${row.sessions} sessions` : row.hasPreRead ? "Pre-read only" : "Not started"}</span>}
          </div>
          {showDetails && <div className="desk-lecture-details">
            <DateEdit row={row} onUpdateDate={onUpdateDate} />
            {row.lastActivityDate && <span>Last studied {row.lastActivityDate}</span>}
            {row.nextReview && <span>Review {row.nextReview}</span>}
            {row.sessions > 0 && <span>{row.sessions} study sessions</span>}
          </div>}
          {showDetails && row.topWeakConcepts.length > 0 && (
            <div className="mt-0.5 font-mono text-[12px] text-bad" title="Your weakest concepts tied to this lecture">
              ⚠ review: {row.topWeakConcepts.join(" · ")}
            </div>
          )}
          {row.repairCount > 0 && <div className="mt-1 text-xs font-semibold text-status-purple">◈ {row.repairCount} model repairs</div>}
        </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <div className="relative">
            <button
              onClick={() => { setMenuOpen((v) => !v); setConfirmDelete(false); }}
              aria-label={`More actions for ${row.title}`}
              className="rounded px-2 font-mono text-[14px] text-text-3 hover:bg-panel hover:text-text-1"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-20 min-w-44 rounded border border-border bg-bg p-2 shadow-lg">
                <RenameLecture userId={userId} lectureId={row.lectureId} title={row.title} onRenamed={() => setMenuOpen(false)} />
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full rounded px-2 py-1.5 text-left text-[13px] text-bad hover:bg-bad/10"
                  >
                    Delete lecture…
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[12px] leading-snug text-text-2">Delete this lecture and its extracted content? This cannot be undone.</p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => onDelete(row)}
                        disabled={deleting === row.lectureId}
                        className="rounded bg-bad px-2 py-1 text-[12px] font-bold text-white disabled:opacity-50"
                      >
                        {deleting === row.lectureId ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-[12px] text-text-3">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={() => setLogging(logging ? null : "review")} className="font-mono text-[12px] text-text-3 hover:text-text-1">
            log
          </button>
          <button type="button" onClick={() => setShowDetails((value) => !value)} className="font-mono text-[12px] text-text-3 hover:text-text-1">
            {showDetails ? "less" : "details"}
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
  const questionStats = useLectureQuestionStats(userId);
  const repairProgress = useStoreResource(atomProgressStore, userId);
  const [filter, setFilter] = useState(() => readFilterPrefs(blockId).filter);
  const [activityType, setActivityType] = useState(() => readFilterPrefs(blockId).activityType);
  const [search, setSearch] = useState(() => readFilterPrefs(blockId).search);
  const [sort, setSort] = useState(() => readFilterPrefs(blockId).sort);
  const [week, setWeek] = useState(() => readFilterPrefs(blockId).week);
  const [logged, setLogged] = useState(null);
  const [preReadTarget, setPreReadTarget] = useState(null);
  const [visibleCount, setVisibleCount] = useState(18);
  const [showAllLectures, setShowAllLectures] = useState(() => readFilterPrefs(blockId).showAllLectures);
  const [deletingLectureId, setDeletingLectureId] = useState(null);
  const [selectedLectureIds, setSelectedLectureIds] = useState(() => new Set());
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  useEffect(() => {
    setSelectedLectureIds(new Set());
    setBulkDeleteTargets(null);
  }, [blockId]);

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
    () => buildLectureRows(scores, { completion: context.completion, blockId, atomProgress: repairProgress.data, filter, activityType, search, sort }),
    [scores, context.completion, blockId, repairProgress.data, filter, activityType, search, sort]
  );
  const allRows = useMemo(
    () => buildLectureRows(scores, { completion: context.completion, blockId, atomProgress: repairProgress.data, filter: "all", activityType: "all", search: "", sort: "lecture" }),
    [scores, context.completion, blockId, repairProgress.data]
  );
  const weeks = useMemo(() => buildLectureWeeks(rows), [rows]);
  const weekRows = useMemo(() => rows.filter((row) => rowMatchesWeek(row, week)), [rows, week]);
  // The compact Focus queue is a recommendation surface, not a preview of the
  // user's last library filter/sort. Future-dated lectures are not actionable
  // yet, so reserve this queue for
  // lectures already released (or with no schedule date).
  const priorityRows = useMemo(
    () => buildLectureRows(scores, {
      completion: context.completion,
      blockId,
      atomProgress: repairProgress.data,
      filter: "active",
      activityType: "all",
      search: "",
      sort: "urgency",
    }).filter((row) => !row.isFuture).slice(0, 6),
    [scores, context.completion, blockId, repairProgress.data]
  );
  const counts = useMemo(
    () => lectureCounts(scores, { completion: context.completion, blockId, atomProgress: repairProgress.data }),
    [scores, context.completion, blockId, repairProgress.data]
  );
  const typeCounts = useMemo(() => {
    const all = buildLectureRows(scores, { completion: context.completion, blockId, filter: "all" });
    return Object.fromEntries(ACTIVITY_TYPES.map((type) => [type, type === "all" ? all.length : all.filter((row) => row.type === type).length]));
  }, [scores, context.completion, blockId]);
  const displayRows = showAllLectures ? weekRows : priorityRows;
  const visibleRows = displayRows.slice(0, visibleCount);
  const questionTotals = useMemo(() => (context.lectures || []).filter((lecture) => lecture.blockId === blockId).reduce((out, lecture) => {
    const stat = questionStats.data?.[lecture.id];
    out.answered += stat?.answered || 0;
    out.correct += stat?.correct || 0;
    return out;
  }, { answered: 0, correct: 0 }), [context.lectures, blockId, questionStats.data]);
  const questionAccuracy = questionTotals.answered ? Math.round((questionTotals.correct / questionTotals.answered) * 100) : null;

  useEffect(() => setVisibleCount(18), [filter, activityType, search, sort, week, blockId]);

  // One-shot per focusLectureId value: `rows` is a dependency only so this
  // can wait for the target row to actually be present (e.g. still loading
  // on first mount), not so it re-fires on every unrelated row
  // recomputation (search/filter/sort changes, background activity-log
  // updates) — `scrolledForRef` gates that.
  const scrolledForRef = useRef(null);
  useEffect(() => {
    if (!focusLectureId) return;
    if (scrolledForRef.current === focusLectureId) return;
    if (!weekRows.some((row) => row.lectureId === focusLectureId)) return;
    scrolledForRef.current = focusLectureId;
    focusRowRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [focusLectureId, weekRows]);

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
    async (lectureId, dateStr) => {
      setLogged(null);
      try {
        await updateLectureDate(userId, lectureId, dateStr);
        setLogged(dateStr ? "Lecture date saved." : "Lecture date cleared.");
        return true;
      } catch (error) {
        setLogged(error?.message || "Could not save the lecture date.");
        return false;
      }
    },
    [userId]
  );

  const onDelete = useCallback(async (row) => {
    const lectureId = row?.lectureId;
    if (!lectureId || deletingLectureId) return;
    setDeletingLectureId(lectureId);
    setLogged(null);
    try {
      await deleteLectureFully({ userId, lectureId, blockId });
      setLogged(`Deleted ${row.title}.`);
    } catch (e) {
      setLogged(`Could not delete ${row.title}: ${e?.message || String(e)}`);
    } finally {
      setDeletingLectureId(null);
    }
  }, [blockId, deletingLectureId, userId]);

  const toggleSelected = useCallback((lectureId) => {
    setSelectedLectureIds((current) => {
      const next = new Set(current);
      if (next.has(lectureId)) next.delete(lectureId);
      else next.add(lectureId);
      return next;
    });
  }, []);

  const selectAllInView = useCallback(() => {
    setSelectedLectureIds((current) => {
      const next = new Set(current);
      const allSelected = weekRows.length > 0 && weekRows.every((row) => next.has(row.lectureId));
      weekRows.forEach((row) => allSelected ? next.delete(row.lectureId) : next.add(row.lectureId));
      return next;
    });
  }, [weekRows]);

  const confirmBulkDelete = useCallback(async () => {
    if (!bulkDeleteTargets?.length || bulkDeleting) return;
    setBulkDeleting(true);
    setBulkProgress(0);
    setLogged(null);
    const targets = bulkDeleteTargets.map((row) => ({
      id: row.lectureId,
      lectureTitle: row.title,
    }));
    let deletedIds = [];
    let failures = [];
    let objectivesSaved = true;
    let objectiveSaveError = null;
    try {
      ({ deletedIds, failures, objectivesSaved, objectiveSaveError } = await deleteLecturesFully({
        userId,
        lectures: targets,
        blockId,
        onProgress: (done) => setBulkProgress(done),
      }));
    } catch (error) {
      objectiveSaveError = error;
    }
    setSelectedLectureIds((current) => {
      const next = new Set(current);
      deletedIds.forEach((id) => next.delete(id));
      return next;
    });
    setLogged(failures.length
      ? `Deleted ${deletedIds.length} of ${bulkDeleteTargets.length}; ${failures.length} failed. Failed: ${failures.map((item) => item.title).join(", ")}.`
      : !objectivesSaved || objectiveSaveError
        ? `Deleted ${deletedIds.length} lectures, but objective links could not be synced: ${objectiveSaveError?.message || "retry sync"}.`
        : `Deleted ${deletedIds.length} selected lecture${deletedIds.length === 1 ? "" : "s"}.`);
    setBulkDeleting(false);
    setBulkDeleteTargets(null);
  }, [blockId, bulkDeleteTargets, bulkDeleting, userId]);

  return (
    <div className="desk-page desk-lectures mx-auto w-full max-w-6xl p-4 sm:p-5">
      <div className="desk-page-heading mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <button onClick={onBack} className="mb-1 font-mono text-xs text-text-3 hover:text-text-1">← block</button>
          <h2 className="text-2xl font-bold text-text-1">Lectures</h2>
          <div className="text-sm text-text-3">Find the next useful lecture, not another endless list.</div>
        </div>
        <div className="desk-count-summary text-sm text-text-2"><strong>{counts.active}</strong> active · <strong>{counts.done}</strong> complete · {counts.all} total · <strong>{questionTotals.answered.toLocaleString()}</strong> questions completed{questionAccuracy == null ? "" : ` · ${questionAccuracy}% accuracy`}</div>
      </div>

      {logged && <div className="mb-2 font-mono text-[12px] text-good">{logged}</div>}

      <details className="desk-lecture-filters mb-4">
        <summary>Filters & sort <span>· {filter} · {week === "all" ? "all weeks" : week} · {activityType} · {SORT_LABELS[sort]}</span></summary>
      <div className="desk-filter-strip mb-3 flex flex-wrap items-center gap-2" aria-label="Lecture status filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); saveFilterPrefs(blockId, { filter: f, ...(f === "repairs" ? { sort: "repairs" } : {}) }); if (f === "repairs") setSort("repairs"); }}
            aria-pressed={filter === f}
            className={
              "rounded border px-3 py-2 text-sm " +
              (filter === f ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")
            }
          >
            {f === "repairs" ? "Model repairs" : f} {counts[f] != null ? `(${counts[f]})` : ""}
          </button>
        ))}
      </div>

      <div className="desk-filter-strip mb-3 flex flex-wrap items-center gap-2" aria-label="School week filters">
        <button
          onClick={() => { setWeek("all"); saveFilterPrefs(blockId, { week: "all" }); }}
          aria-pressed={week === "all"}
          className={"rounded border px-3 py-2 text-sm " + (week === "all" ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")}
        >
          All weeks ({rows.length})
        </button>
        {weeks.map((item) => (
          <button
            key={item.key}
            onClick={() => { setWeek(item.key); saveFilterPrefs(blockId, { week: item.key }); }}
            aria-pressed={week === item.key}
            className={"rounded border px-3 py-2 text-sm " + (week === item.key ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")}
            title={item.range ? `${item.label} · ${item.range}` : item.label}
          >
            {item.label}{item.range ? ` · ${item.range}` : ""} ({item.count})
          </button>
        ))}
      </div>

      <div className="desk-toolbar mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-bg-elevated p-3">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-text-3">Type</span>
        {ACTIVITY_TYPES.filter((type) => type === "all" || typeCounts[type] > 0).map((type) => (
          <button
            key={type}
            onClick={() => { setActivityType(type); saveFilterPrefs(blockId, { activityType: type }); }}
            className={"rounded-lg px-3 py-2 text-sm " + (activityType === type ? "bg-accent text-bg" : "text-text-3 hover:bg-panel hover:text-text-1")}
          >
            {type === "all" ? "All types" : type} ({typeCounts[type]})
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); saveFilterPrefs(blockId, { search: e.target.value }); }}
          placeholder="Search lectures"
          aria-label="Search lectures"
          className="ml-auto min-h-11 min-w-52 rounded-lg border border-border bg-panel px-3 text-sm text-text-1"
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            saveFilterPrefs(blockId, { sort: e.target.value });
          }}
          aria-label="Sort lectures"
          className="min-h-11 rounded-lg border border-border bg-panel px-3 text-sm text-text-2"
        >
          {Object.entries(SORT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
      </details>

      <section className="desk-lecture-focus-bar" aria-label="Lecture focus queue">
        <div>
          <div className="today-eyebrow">{showAllLectures ? "Lecture library" : "Focus queue"}</div>
          <strong>{showAllLectures ? `${weekRows.length} lectures in this view` : `${priorityRows.length} next lectures to consider`}</strong>
          <span>{showAllLectures ? "Use the filters above to narrow the library." : "Ranked by the same evidence-aware urgency as Today. Filters and custom sorting apply in the full library."}</span>
        </div>
        <button type="button" className="desk-lecture-focus-toggle" onClick={() => {
          setShowAllLectures((value) => {
            const next = !value;
            saveFilterPrefs(blockId, { showAllLectures: next });
            return next;
          });
          setVisibleCount(18);
        }}>
          {showAllLectures ? "Return to focus queue" : `Browse all ${weekRows.length} lectures`}
        </button>
      </section>

      {showAllLectures && weekRows.length > 0 && <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3">
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input type="checkbox" checked={weekRows.every((row) => selectedLectureIds.has(row.lectureId))} onChange={selectAllInView} aria-label={`Select all ${weekRows.length} lectures in this view`} className="h-4 w-4 accent-accent" />
          Select all {weekRows.length} in this view
        </label>
        <span className="font-mono text-xs text-text-3">{selectedLectureIds.size} selected</span>
        <button type="button" disabled={!selectedLectureIds.size} onClick={() => setBulkDeleteTargets(allRows.filter((row) => selectedLectureIds.has(row.lectureId)))} className="rounded-lg border border-bad px-3 py-2 text-sm font-semibold text-bad hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-50">
          Delete selected…
        </button>
        {selectedLectureIds.size > 0 && <button type="button" onClick={() => setSelectedLectureIds(new Set())} className="text-sm text-text-3 hover:text-text-1">Clear selection</button>}
      </div>}

      {displayRows.length === 0 ? (
        <div className="rounded-lg border border-border p-3 text-xs text-text-3">{showAllLectures ? "Nothing matches that filter." : "No released lectures need focus right now."}</div>
      ) : (
        <div className="desk-lecture-list rounded-xl border border-border bg-bg-elevated px-4">
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
              userId={userId}
              onPreRead={setPreReadTarget}
              onDelete={onDelete}
              deleting={deletingLectureId}
              focused={row.lectureId === highlightId}
              rowRef={row.lectureId === focusLectureId ? focusRowRef : undefined}
              selectable={showAllLectures}
              selected={selectedLectureIds.has(row.lectureId)}
              onToggleSelected={toggleSelected}
            />
          ))}
        </div>
      )}
      {showAllLectures && visibleCount < weekRows.length && (
        <button onClick={() => setVisibleCount((n) => n + 30)} className="mt-3 w-full rounded-lg border border-border py-2 font-mono text-[12px] text-text-2 hover:border-accent hover:text-text-1">
          Show 18 more · {weekRows.length - visibleCount} remaining
        </button>
      )}

      {preReadTarget && (
        <PreReadModal
          lecture={preReadTarget.lec}
          userId={userId}
          objectives={objectivesForTask(preReadTarget.lectureId)}
          onClose={() => setPreReadTarget(null)}
          onComplete={({ lectureId, gapObjectiveIds, durationMinutes }) => {
            logPreRead({ lectureId, gapObjectiveIds, durationMinutes });
            setPreReadTarget(null);
          }}
        />
      )}

      {bulkDeleteTargets && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
        <section role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title" className="max-h-[85vh] w-full max-w-xl overflow-hidden rounded-xl border border-border bg-bg p-5 shadow-2xl">
          <h3 id="bulk-delete-title" className="text-lg font-bold text-text-1">Delete {bulkDeleteTargets.length} selected lecture{bulkDeleteTargets.length === 1 ? "" : "s"}?</h3>
          <p className="mt-2 text-sm leading-relaxed text-text-2">This permanently removes the lecture records and extracted content. Imported curriculum objectives will be kept but unlinked. This cannot be undone.</p>
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-2">
            {bulkDeleteTargets.map((row) => <li key={row.lectureId}>{row.type} {row.number ?? ""} · {row.title}</li>)}
          </ul>
          {bulkDeleting && <p className="mt-3 text-sm text-text-2" role="status">Deleting {bulkProgress} of {bulkDeleteTargets.length}…</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={bulkDeleting} onClick={() => setBulkDeleteTargets(null)} className="rounded-lg border border-border px-3 py-2 text-sm text-text-2 disabled:opacity-50">Cancel</button>
            <button type="button" disabled={bulkDeleting} onClick={() => void confirmBulkDelete()} className="rounded-lg bg-bad px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{bulkDeleting ? "Deleting…" : `Confirm delete ${bulkDeleteTargets.length}`}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

export default LectureList;
