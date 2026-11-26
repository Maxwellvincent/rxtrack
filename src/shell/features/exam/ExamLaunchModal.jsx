import {SCHOOL_EXAM_TARGET_PERCENT} from "../../logic/performanceTargets.js";
import { ASSESSMENT_FORMATS, defaultScopeFor } from "./assessmentFormats.js";
import { BPM_BLUEPRINTS, SUBJECT_LABELS, subjectTargets, blueprintInventory } from "./bpmBlueprint.js";
import { useEffect, useState } from "react";
import { examDurationMinutes } from "./examTiming.js";
import { filterLecturesByScope, fridayWeekKey, scopeLabel } from "../../logic/weekScope.js";
import { suggestedExamName } from "./preparedSetNaming.js";

// A full school-prep sitting can now reach 100 questions. Keeping the cap here
// (rather than accepting an arbitrary number) still protects the generation
// path from accidental, very expensive launches.
const MAX_QUESTION_COUNT = 100;

export function examBlueprint(eligibleLectures = [], questionCount = 0) {
  const lectures = (eligibleLectures || []).filter((l) => l?.lectureId);
  const objectiveCount = lectures.reduce((sum, l) => sum + (l.objectiveCount || 0), 0);
  return {
    lectureCount: lectures.length,
    objectiveCount,
    guaranteedLectureCoverage: Math.min(lectures.length, questionCount),
    objectiveSamplingCapacity: Math.min(objectiveCount, questionCount),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const shortDay = (date) => `${MONTHS[date.getMonth()]} ${date.getDate()}`;

/**
 * School weeks of the block, oldest first. Stored week numbers win; lectures
 * without one are grouped into Monday–Friday weeks by date and numbered in
 * order. Each week carries the content scope that selects exactly it.
 */
export function schoolWeeks(lectures = []) {
  const list = (lectures || []).filter((lecture) => lecture?.lectureId);
  if (list.some((lecture) => lecture.weekNumber != null)) {
    return [...new Set(list.map((lecture) => lecture.weekNumber).filter((week) => week != null).map(String))]
      .sort((a, b) => Number(a) - Number(b))
      .map((week) => {
        const members = list.filter((lecture) => String(lecture.weekNumber) === week);
        const dates = members.map((lecture) => lecture.lectureDate || lecture.date).filter(Boolean).map((date) => String(date).slice(0, 10)).sort();
        return { id: week, number: Number(week), label: `Week ${week}`, range: "", scope: week, count: members.length, firstDate: dates[0] || "" };
      });
  }
  const byFriday = new Map();
  for (const lecture of list) {
    const date = lecture.lectureDate || lecture.date;
    if (!date) continue;
    const key = fridayWeekKey(date);
    byFriday.set(key, (byFriday.get(key) || 0) + 1);
  }
  return [...byFriday.keys()].sort().map((friday, index) => {
    const end = new Date(`${friday}T00:00:00`);
    const start = new Date(end); start.setDate(end.getDate() - 4);
    return { id: friday, number: index + 1, label: `Week ${index + 1}`, range: `${shortDay(start)}–${shortDay(end)}`,
      start: isoDay(start), end: friday, scope: `date-range:${isoDay(start)}:${friday}`, count: byFriday.get(friday), firstDate: isoDay(start) };
  });
}

/** The most recent week that has started by `now`, else the last week. */
export function currentSchoolWeek(weeks = [], now = new Date()) {
  const today = isoDay(now);
  const started = weeks.filter((week) => week.firstDate && week.firstDate <= today);
  return (started[started.length - 1] || weeks[weeks.length - 1])?.id || "";
}

function weekSpanScope(from, to) {
  if (!from || !to) return "";
  const [low, high] = from.number <= to.number ? [from, to] : [to, from];
  return low.start ? `date-range:${low.start}:${high.end}` : `week-range:${low.id}:${high.id}`;
}

function weekSpanLabel(from, to) {
  const [low, high] = from.number <= to.number ? [from, to] : [to, from];
  return low.id === high.id ? low.label : `Weeks ${low.number}–${high.number}`;
}

/**
 * Presentational config modal shown before launching an Integrated Exam
 * session. Collects format/count/duration and does the simple "zero
 * eligible lectures" feasibility check inline — it does NOT call
 * generation or session-creation code itself; that's `launchExam.js`'s
 * job (Part B), invoked by the caller via `onLaunch`.
 *
 * Props:
 *   blockId              string
 *   userId               string
 *   eligibleLectures     [{lectureId, lectureLabel, objectiveCount}]
 *   defaultQuestionCount number — pre-resolved by the parent
 *   onLaunch({ format, questionCount, durationMinutes }) => void
 *   onCancel () => void
 *   launching             bool — Task 12's fix for a double-launch race:
 *     while true, both buttons are disabled and Start reads "Starting…" so a
 *     second click during the (multi-second, real-AI-cost) generation call
 *     can't fire a second launch.
 */
export function ExamLaunchModal({
  blockId: _blockId,
  userId: _userId,
  eligibleLectures = [],
  defaultBlueprintExam = "",
  defaultKind = "",
  defaultStudyMode = "balanced",
  defaultTargetObjectiveIds = [],
  defaultFocusNotes = "",
  blueprintLectures = [],
  blueprintObjectives = {},
  defaultQuestionCount,
  onLaunch,
  onCancel,
  launching = false,
  progress = null,
  error = null,
  onPrepare,
  partialLaunch = null,
  onStartSaved,
  savedQuestionCount: _savedQuestionCount = 0,
  existingNames = [],
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!launching) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [launching]);
  const weekOptions = schoolWeeks(eligibleLectures);
  const availableWeeks = weekOptions.map((option) => option.id);
  const latestWeek = currentSchoolWeek(weekOptions);
  const latestIndex = Math.max(0, availableWeeks.indexOf(latestWeek));
  const weekById = Object.fromEntries(weekOptions.map((option) => [option.id, option]));
  const openedForTarget = !!defaultFocusNotes || defaultTargetObjectiveIds.length > 0 || defaultStudyMode === "repair";
  const requestedKind = ["homework", "imcq", "esoft", "full"].includes(defaultKind) ? defaultKind : "";
  const initialKind = defaultBlueprintExam ? "full" : requestedKind && !(requestedKind !== "homework" && !availableWeeks.length) ? requestedKind
    : openedForTarget || !availableWeeks.length ? "custom" : "imcq";
  // What the set imitates: one lecture (homework), one week (IMCQ), a span of
  // weeks (ESoft), the whole NB blueprint, or any other scope (custom).
  const [kind, setKind] = useState(initialKind);
  const [blueprintTest, setBlueprintTest] = useState(String(defaultBlueprintExam || Object.keys(BPM_BLUEPRINTS).slice(-1)[0] || ""));
  const blueprintExam = kind === "full" ? blueprintTest : "";
  const [format, setFormat] = useState(initialKind === "full" ? "exam" : "practice");
  const [studyMode, setStudyMode] = useState(defaultStudyMode === "repair" ? "repair" : "balanced");
  const [difficulty, setDifficulty] = useState("adaptive");
  const initialCount = Math.max(1, Math.min(MAX_QUESTION_COUNT, parseInt(defaultQuestionCount, 10) || 20));
  const [count, setCount] = useState(String(initialCount));
  // Auto-calculated from question count (72 seconds/question, matching real
  // exam pacing) until the user types into the duration field themselves.
  const [duration, setDuration] = useState(() => String(examDurationMinutes(initialCount)));
  const [durationTouched, setDurationTouched] = useState(false);
  const [lectureChoice, setLectureChoice] = useState(() => defaultScopeFor("homework", eligibleLectures));
  const [week, setWeek] = useState(latestWeek);
  const [weekFrom, setWeekFrom] = useState(availableWeeks[Math.max(0, latestIndex - 1)] || "");
  const [weekTo, setWeekTo] = useState(latestWeek);
  const [contentScope, setContentScope] = useState("block-so-far");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [includeSeen, setIncludeSeen] = useState(false);
  const [focusNotes, setFocusNotes] = useState(defaultFocusNotes);
  const [examNameOverride, setExamNameOverride] = useState(null);
  const chooseKind = (next) => { setKind(next); setFormat(next === "full" ? "exam" : "practice"); setExamNameOverride(null); };

  const effectiveScope = kind === "full" ? "entire-block"
    : kind === "homework" ? lectureChoice
    : kind === "imcq" ? (weekById[week]?.scope || "")
    : kind === "esoft" ? weekSpanScope(weekById[weekFrom], weekById[weekTo])
    : contentScope === "custom-dates" && rangeStart && rangeEnd ? `date-range:${rangeStart}:${rangeEnd}` : contentScope;
  const assessmentFormat = ["homework", "imcq", "esoft"].includes(kind) ? kind : null;
  const scopedLectures = blueprintExam ? blueprintLectures : filterLecturesByScope(eligibleLectures, effectiveScope);
  const effectiveScopeLabel = kind === "imcq" && weekById[week] ? weekById[week].label
    : kind === "esoft" && weekById[weekFrom] && weekById[weekTo] ? weekSpanLabel(weekById[weekFrom], weekById[weekTo])
    : scopeLabel(effectiveScope, eligibleLectures);
  const inventory = blueprintInventory(blueprintLectures, blueprintObjectives);
  const noLectures = !scopedLectures || scopedLectures.length === 0;

  const parsedCount = Math.max(1, Math.min(MAX_QUESTION_COUNT, parseInt(count, 10) || 1));
  const parsedDuration = parseFloat(duration);
  const suggestedName = suggestedExamName({
    format,
    scopeLabel: blueprintExam ? `BPM 2 Test ${blueprintExam}` : `${assessmentFormat ? `${ASSESSMENT_FORMATS[assessmentFormat].label} · ` : ""}${effectiveScopeLabel}`,
    questionCount: parsedCount,
    existingNames,
  });
  const examName = examNameOverride ?? suggestedName;
  const durationValid = format !== "exam" || (Number.isFinite(parsedDuration) && parsedDuration > 0);
  const datesValid = kind !== "custom" || contentScope !== "custom-dates" || (rangeStart && rangeEnd && rangeStart <= rangeEnd);
  const missingSubjects = blueprintExam ? subjectTargets(blueprintExam, parsedCount).filter(row=>row.count && !inventory.counts[row.subject]) : [];
  const canLaunch = !noLectures && durationValid && datesValid && !missingSubjects.length && (kind !== "full" || !!blueprintExam);
  const blueprint = examBlueprint(scopedLectures, parsedCount);
  const crossShare = assessmentFormat ? ASSESSMENT_FORMATS[assessmentFormat].crossLectureShare : kind === "custom" ? ASSESSMENT_FORMATS.custom.crossLectureShare : 0;

  const handleCountChange = (e) => {
    const raw = e.target.value;
    if (raw === "") { setCount(""); return; }
    const n = Math.max(1, Math.min(MAX_QUESTION_COUNT, parseInt(raw, 10) || 1));
    setCount(String(n));
    if (!durationTouched) setDuration(String(examDurationMinutes(n)));
  };
  const pickCount = (n) => handleCountChange({ target: { value: String(n) } });
  const handleDurationChange = (e) => { setDurationTouched(true); setDuration(e.target.value); };

  /** One launch payload for Start, Prepare and Start-with-saved. */
  const payload = (extra = {}) => ({
    format,
    examName: examName.trim() || suggestedName,
    ...(blueprintExam ? { blueprintExam: Number(blueprintExam), contentScope: "entire-block" } : effectiveScope === "block-so-far" ? {} : /^\d+$/.test(String(effectiveScope)) ? { weekNumber: effectiveScope } : { contentScope: effectiveScope }),
    ...(studyMode === "repair" ? { studyMode } : {}),
    ...(difficulty !== "adaptive" ? { difficultyOverride: difficulty } : {}),
    questionCount: parsedCount,
    durationMinutes: format === "exam" ? parsedDuration : null,
    includeSeen,
    ...(defaultTargetObjectiveIds.length ? { targetObjectiveIds: defaultTargetObjectiveIds } : {}),
    ...(assessmentFormat ? { assessmentFormat } : {}),
    ...(focusNotes.trim() ? { focusNotes: focusNotes.trim() } : {}),
    ...extra,
  });
  const handleLaunch = () => { if (canLaunch) onLaunch(payload({ startWhilePreparing: true })); };

  const KINDS = [
    { id: "homework", label: "Homework", note: "One lecture" },
    { id: "imcq", label: "IMCQ", note: "One week of lectures" },
    { id: "esoft", label: "ESoft", note: "2–3 weeks of lectures" },
    { id: "full", label: "Full NB exam", note: "Whole block, school blueprint" },
  ];
  const sectionLabel = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-3";
  const selectClass = "w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-1";
  const lectureOptions = [...eligibleLectures].filter((lecture) => lecture?.lectureId)
    .sort((a, b) => String(b.lectureDate || b.date || "").localeCompare(String(a.lectureDate || a.date || "")) || (Number(b.lectureNumber) || 0) - (Number(a.lectureNumber) || 0));

  return (
    <div role="dialog" aria-modal="true" aria-label="Exam settings"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-bg p-5 shadow-xl sm:max-h-[calc(100dvh-5rem)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-1">New practice set</h2>
          <button type="button" onClick={onCancel} disabled={launching} aria-label="Close exam settings" className="rounded px-2 py-1 text-sm text-text-3 hover:text-text-1 disabled:opacity-40">✕</button>
        </div>

        <fieldset disabled={launching} className="flex flex-col gap-5">
          <section>
            <span className={sectionLabel}>1 · Practice like</span>
            <div role="radiogroup" aria-label="Practice like" className="grid grid-cols-2 gap-2">
              {KINDS.map((item) => (
                <button key={item.id} type="button" role="radio" aria-checked={kind === item.id} onClick={() => chooseKind(item.id)}
                  className={`rounded-lg border-2 p-3 text-left ${kind === item.id ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong"}`}>
                  <span className="block text-sm font-semibold text-text-1">{kind === item.id ? "● " : "○ "}{item.label}</span>
                  <span className="mt-0.5 block text-xs text-text-3">{item.note}</span>
                </button>
              ))}
            </div>
            {kind === "custom" && <p className="mt-2 text-xs text-text-2">Custom scope · change it under More options, or pick a format above.</p>}
          </section>

          <section>
            <span className={sectionLabel}>2 · {kind === "homework" ? "Which lecture" : kind === "imcq" ? "Which week" : kind === "esoft" ? "Which weeks" : kind === "full" ? "Which exam" : "Scope"}</span>
            {kind === "homework" && <select aria-label="Lecture" value={lectureChoice} onChange={(e) => setLectureChoice(e.target.value)} className={selectClass}>
              {lectureOptions.map((lecture) => <option key={lecture.lectureId} value={`lecture:${encodeURIComponent(lecture.lectureId)}`}>{lecture.lectureLabel || lecture.lectureTitle || lecture.fileName || lecture.lectureId}</option>)}
            </select>}
            {kind === "imcq" && (availableWeeks.length
              ? <select aria-label="Week" value={week} onChange={(e) => setWeek(e.target.value)} className={selectClass}>
                  {[...weekOptions].reverse().map((option) => <option key={option.id} value={option.id}>{option.label}{option.range ? ` · ${option.range}` : ""} · {option.count} lecture{option.count === 1 ? "" : "s"}</option>)}
                </select>
              : <p className="text-sm text-text-2">Your lectures have no dates or week numbers yet. Import the schedule, or use More options → scope.</p>)}
            {kind === "esoft" && <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-text-3">From<select aria-label="From week" value={weekFrom} onChange={(e) => setWeekFrom(e.target.value)} className={`mt-1 ${selectClass}`}>{weekOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label className="text-xs text-text-3">Through<select aria-label="Through week" value={weekTo} onChange={(e) => setWeekTo(e.target.value)} className={`mt-1 ${selectClass}`}>{weekOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            </div>}
            {kind === "full" && <>
              <select id="bpm-blueprint" aria-label="Exam blueprint" value={blueprintTest} onChange={e=>{setBlueprintTest(e.target.value);setExamNameOverride(null);}} className={selectClass}>
                {Object.keys(BPM_BLUEPRINTS).map(n=><option key={n} value={n}>BPM 2 · Test {n}</option>)}
              </select>
              {blueprintExam && <p className="mt-2 text-xs text-text-2">{subjectTargets(blueprintExam,parsedCount).filter(row=>row.count).map(row=>`${SUBJECT_LABELS[row.subject]} ${row.count}`).join(" · ")} questions</p>}
              {!!missingSubjects.length && <p role="alert" className="mt-2 text-sm text-bad">✕ Missing linked objectives: {missingSubjects.map(row=>SUBJECT_LABELS[row.subject]).join(', ')}.</p>}
            </>}
            {kind === "custom" && <>
              <select aria-label="Content scope" value={contentScope} onChange={(event) => setContentScope(event.target.value)} className={selectClass}>
                {[
                  ["current-week", "This week · ends Friday"],
                  ["past-two-weeks", "Past 2 weeks · Friday cutoff"],
                  ["block-so-far", "Block so far"],
                  ["entire-block", "Entire block"],
                  ["custom-dates", "Choose exact dates…"],
                  ...weekOptions.map((option) => [option.scope, option.label]),
                  ...eligibleLectures.filter((lecture) => lecture?.lectureId).map((lecture) => [`lecture:${encodeURIComponent(lecture.lectureId)}`, `Lecture · ${lecture.lectureLabel || lecture.lectureTitle || lecture.fileName || lecture.lectureId}`]),
                ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {contentScope === "custom-dates" && <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs text-text-3">From<input aria-label="Scope start date" type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} className={`mt-1 ${selectClass}`} /></label>
                <label className="text-xs text-text-3">Through<input aria-label="Scope end date" type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} className={`mt-1 ${selectClass}`} /></label>
              </div>}
            </>}
            <p className="mt-2 text-xs text-text-3" aria-label="Set summary">
              {noLectures ? "No lectures with objectives in this choice." : `${blueprint.lectureCount} lecture${blueprint.lectureCount === 1 ? "" : "s"} · ${blueprint.objectiveCount} objectives`}
              {!noLectures && crossShare > 0 && blueprint.lectureCount > 1 ? ` · about ${Math.round(crossShare * 100)}% of questions link two lectures` : ""}
            </p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="exam-question-count" className={sectionLabel}>3 · Questions</label>
              <div className="flex flex-wrap items-center gap-1.5">
                <input id="exam-question-count" aria-label="Number of questions" type="number" min="1" step="1" max={MAX_QUESTION_COUNT} value={count} onChange={handleCountChange}
                  className="w-16 rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-1" />
                {[10, 20, 40].map((n) => <button key={n} type="button" onClick={() => pickCount(n)} aria-pressed={parsedCount === n}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs ${parsedCount === n ? "border-accent text-text-1" : "border-border text-text-3"}`}>{n}</button>)}
              </div>
            </div>
            <div>
              <span className={sectionLabel}>4 · Mode</span>
              <div className="flex gap-1.5">
                {[{ value: "practice", label: "Practice" }, { value: "exam", label: "Timed exam" }].map((opt) => (
                  <button key={opt.value} type="button" aria-pressed={format === opt.value} onClick={() => setFormat(opt.value)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${format === opt.value ? "border-accent bg-accent-soft text-text-1" : "border-border text-text-3"}`}>{opt.label}</button>
                ))}
              </div>
              {format === "exam" ? <label className="mt-2 flex items-center gap-2 text-xs text-text-3">Duration
                <input aria-label="Duration (minutes)" type="number" min="1" step="0.5" value={duration} onChange={handleDurationChange} placeholder="Required" className="w-16 rounded border border-border bg-bg-elevated px-2 py-1 text-sm text-text-1" /> min{!durationTouched ? " · 72 s each" : ""}
              </label> : <p className="mt-2 text-xs text-text-3">Untimed · you answer before seeing the choices</p>}
            </div>
          </section>

          <details className="rounded-lg border border-border p-3" open={openedForTarget || undefined}>
            <summary className="cursor-pointer text-sm font-semibold text-text-2">More options</summary>
            <div className="mt-3 flex flex-col gap-4">
              <div>
                <span className={sectionLabel}>Question focus</span>
                <div className="grid grid-cols-2 gap-2">
                  {[{ value: "balanced", label: "Balanced", note: "Broad coverage" }, { value: "repair", label: "Focused repair", note: "Weak objectives first" }].map((option) => <button type="button" key={option.value} aria-pressed={studyMode === option.value} onClick={() => setStudyMode(option.value)} className={`rounded-lg border p-2 text-left ${studyMode === option.value ? "border-accent bg-panel" : "border-border"}`}>
                    <span className="block text-sm font-semibold text-text-1">{option.label}</span><span className="block text-xs text-text-3">{option.note}</span>
                  </button>)}
                </div>
                {studyMode === "repair" && <p className="mt-2 text-xs text-text-2">An objective leaves this queue after at least 5 recent answers reach {SCHOOL_EXAM_TARGET_PERCENT}%.</p>}
              </div>
              <div>
                <span className={sectionLabel}>Difficulty</span>
                <div className="flex flex-wrap gap-1.5">
                  {[["adaptive", "Adaptive"], ["medium", "Medium"], ["hard", "Hard"], ["expert", "Expert"]].map(([value, label]) => <button type="button" key={value} aria-pressed={difficulty === value} onClick={() => setDifficulty(value)} className={`rounded-lg border px-3 py-1.5 text-sm ${difficulty === value ? "border-accent bg-panel text-text-1" : "border-border text-text-3"}`}>{label}</button>)}
                </div>
              </div>
              <div>
                <label className={sectionLabel} htmlFor="exam-focus-notes">Concept drill (optional)</label>
                <textarea id="exam-focus-notes" value={focusNotes} onChange={(event) => setFocusNotes(event.target.value)} rows={3} placeholder="e.g. Weber vs Rinne; conductive vs sensorineural hearing loss" className="w-full resize-y rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-1 placeholder:text-text-3" />
                <label className="mt-2 flex items-center gap-2 text-sm text-text-2"><input type="checkbox" checked={includeSeen} onChange={event => setIncludeSeen(event.target.checked)} /> Include school questions I already answered</label>
              </div>
              <div>
                <label className={sectionLabel} htmlFor="exam-name">Name</label>
                <input id="exam-name" aria-label="Quiz or exam name" value={examName} onChange={(event) => setExamNameOverride(event.target.value)} maxLength={100} className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-1" />
              </div>
              {kind !== "custom" && <button type="button" onClick={() => chooseKind("custom")} className="self-start text-sm text-accent-text underline">Use another scope (block so far, exact dates…)</button>}
            </div>
          </details>
        </fieldset>

        {launching && (
          <div role="status" className="mt-4 rounded-lg border border-accent bg-panel p-3 text-sm text-text-1">
            <div className="flex items-center gap-2"><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Preparing · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</div>
            <div className="mt-2">{progress?.message || "Preparing questions…"}</div>
            {progress?.total > 0 && <><progress aria-label="Questions prepared" className="mt-2 w-full" value={progress.completed || 0} max={progress.total} /><div>{progress.completed || 0}/{progress.total} questions prepared</div></>}
            <div className="mt-2 text-xs text-text-2">Saved questions are used first. Keep this tab open.</div>
          </div>
        )}
        {!launching && error && <div role="alert" className="mt-4 rounded-lg border border-bad p-3 text-sm text-text-1">{error}</div>}
        {!launching && partialLaunch?.readyCount > 0 && (
          <button type="button" onClick={() => onStartSaved?.(payload({ questionCount: partialLaunch.readyCount }))} className="mt-3 min-h-11 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white">
            Start with {partialLaunch.readyCount} saved questions and fill the rest
          </button>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {onPrepare ? <button type="button" disabled={!canLaunch || launching} onClick={() => onPrepare(payload())} title="Saves the questions to start later. No timer or score starts."
            className="text-sm text-text-2 underline disabled:opacity-40">Prepare for later</button> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} disabled={launching} className="rounded-lg border border-border px-4 py-2 text-sm text-text-2 hover:text-text-1 disabled:opacity-40">Cancel</button>
            <button type="button" onClick={handleLaunch} disabled={!canLaunch || launching} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {launching ? "Opening…" : studyMode === "repair" ? "Start focused repair" : "Start"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
