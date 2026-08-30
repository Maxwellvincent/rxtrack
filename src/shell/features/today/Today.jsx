import { useCallback, useState, useMemo, useEffect } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useToday } from "./useToday.js";
import { BlockPracticeCard } from "./BlockPracticeCard.jsx";
import { ModelRetrievalCard } from "./ModelRetrievalCard.jsx";
import { PreReadModal } from "../lectures/PreReadModal.jsx";
import { usePreReadPrefetch } from "../lectures/usePreReadPrefetch.js";
import * as examDatesStore from "../../../stores/examDates.js";
import { readTaskListCollapsed, writeTaskListCollapsed } from "../../navPrefs.js";

// ─── Day mode ────────────────────────────────────────────────────────────────

const DAY_MODES = [
  { id: "lecture",  label: "Lecture day",  desc: "Pre-learn AM, lectures, review PM." },
  { id: "review",   label: "Review",       desc: "No lectures. Qs + cumulative review." },
  { id: "triage",   label: "Triage",       desc: "Recover. Less today, essentials only." },
];

function dayModeKey(blockId) { return `rxt-day-mode-${blockId}`; }
function readDayMode(blockId) { return localStorage.getItem(dayModeKey(blockId)) || null; }
function writeDayMode(blockId, mode) { localStorage.setItem(dayModeKey(blockId), mode); }

function sleepWakeKey(blockId) { return `rxt-sleepwake-${blockId}-${new Date().toDateString()}`; }
function readSleepWake(blockId) {
  try { return JSON.parse(localStorage.getItem(sleepWakeKey(blockId)) || "{}"); }
  catch { return {}; }
}

// Wake time "HH:MM" → suggested mode
function wakeTimeMode(wakeStr) {
  if (!wakeStr) return null;
  const h = parseInt(wakeStr.split(":")[0], 10);
  if (h < 8)  return "lecture";   // before 8am → default (5am wake = lecture day)
  if (h < 10) return "review";    // 8–10am → compressed
  return "triage";                // 10am+ → salvage/triage
}

// ─── Lecture config (block-scoped — same every day for the term) ──────────────

function lecConfigKey(blockId) { return `rxt-lecconfig-${blockId}`; }
function readLecConfig(blockId) {
  try {
    const raw = localStorage.getItem(lecConfigKey(blockId));
    if (raw) return { smallGroup: true, gymTime: "21:00", leaveHomeTime: "06:30", ...JSON.parse(raw) };
    // Migrate from old single-key format
    const oldTime = localStorage.getItem(`rxt-lectime-${blockId}`);
    return { time: oldTime || "08:00", duration: 60, smallGroup: true, gymTime: "21:00", leaveHomeTime: "06:30" };
  } catch { return { time: "08:00", duration: 60, smallGroup: true, gymTime: "21:00", leaveHomeTime: "06:30" }; }
}

// ─── Schedule time helpers ─────────────────────────────────────────────────────

function toMins(hhmm) {
  if (!hhmm) return null;
  const parts = hhmm.split(":");
  return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
}

function fromMins(totalMins) {
  const norm = ((totalMins % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtRange(s, e) { return `${fromMins(s)}–${fromMins(e)}`; }

// ─── Schedule blocks — computed from actual times ──────────────────────────────

/**
 * wakeTime: "HH:MM" string
 * lectureTime: "HH:MM" string — when first lecture starts
 * lectureDuration: minutes per lecture (e.g. 50)
 * Lectures are assumed back-to-back; total block = lectureDuration × 2.
 *
 * Two structural cases:
 *   EARLY (<10am) — no morning pre-learn window. Lectures = primary teaching.
 *                   Deep-learn both lectures in the afternoon.
 *   LATE  (≥10am) — morning pre-learn before lectures, then filter + review.
 */
function computeLegacySchedule(mode, wakeTime, lectureTime, lectureDuration) {
  const w   = toMins(wakeTime)    ?? 7 * 60;    // fallback 07:00
  const l   = toMins(lectureTime) ?? 13 * 60;   // fallback 13:00
  const dur = lectureDuration > 0 ? lectureDuration : 60;
  const lecEnd = l + dur * 2;                    // both lectures done

  // Pre-learn is viable when there's 2h+ between wake and lecture start.
  // 5am wake + 8am lecture = 3h → pre-learn. 7am wake + 8am lecture = 1h → no.
  const prelearnStart = w + 30;   // after Anki reviews
  const skimStart     = l - 90;
  const hasPrelearn   = skimStart - prelearnStart >= 30;
  const hasLectures   = !!lectureTime;

  if (mode === "lecture") {
    if (hasLectures && !hasPrelearn) {
      // Not enough window before lectures — lectures = primary teaching.
      // Deep-learn happens in the afternoon.
      const postBreak = lecEnd + 20;
      return [
        { time: fmtRange(w, w + 30),                 label: "Wake + Anki reviews",           note: "Reviews only. No new unsuspends." },
        { time: fmtRange(w + 30, l),                 label: "Skim objectives",               note: "Quick scan of both lectures' objectives. Not study." },
        { time: fmtRange(l, l + dur),                label: "Lecture A — primary teaching",  note: "Engaged note-taking. Tag ⭐ mechanisms, ❗ gaps.", key: true },
        { time: fmtRange(l + dur, lecEnd),           label: "Lecture B — primary teaching",  note: "Engaged note-taking. Tag ⭐ ❗.", key: true },
        { time: fmtRange(lecEnd, postBreak),         label: "Break",                          note: "" },
        { time: fmtRange(postBreak, postBreak + 120),label: "Deep-learn Lec A",              note: "Mechanism map, teach-back, self-test on pre-made deck.", key: true },
        { time: fmtRange(postBreak + 120, postBreak + 180), label: "Lunch",                  note: "Off." },
        { time: fmtRange(postBreak + 180, postBreak + 300), label: "Deep-learn Lec B",       note: "Mechanism map, teach-back. Unsuspend ~20–30 cards/deck.", key: true },
        { time: fmtRange(postBreak + 300, postBreak + 330), label: "Old-lecture review",     note: "2–3 stalest. Self-test or rapid pull." },
        { time: fmtRange(postBreak + 330, postBreak + 360), label: "DLA (if pending)",       note: "Self-study. Slot one if due ≤5 days." },
        { time: fmtRange(postBreak + 360, postBreak + 480), label: "Dinner + life",          note: "Off." },
        { time: fmtRange(postBreak + 480, postBreak + 540), label: "Anki catch-up + Qs",    note: "Mature reviews. 5–15 practice questions." },
        { time: fmtRange(postBreak + 540, postBreak + 600), label: "Wind-down",              note: "Set tomorrow's must-dos. Screens off." },
        { time: fromMins(24 * 60),                    label: "Sleep target",                 note: "", key: true },
      ];
    }
    // Pre-learn window exists (or no lecture time set) — morning = the study engine
    return [
      { time: fmtRange(w, w + 30),              label: "Wake + Anki reviews",              note: "Reviews only. No new unsuspends." },
      ...(hasPrelearn ? [
        { time: fmtRange(prelearnStart, skimStart), label: "Pre-learn Lec A",              note: "Mechanism map, teach-back, self-test on pre-made deck.", key: true },
        { time: fmtRange(skimStart, l - 60),    label: "Skim Lec B",                       note: "5 min on objectives + 3 questions." },
        { time: fmtRange(l - 60, l),            label: "Lunch",                            note: "Off." },
      ] : [
        { time: fmtRange(w + 30, l),            label: "Prep (limited window)",            note: "Skim both lectures' objectives. Not enough time for full pre-learn." },
      ]),
      { time: fmtRange(l, l + dur),             label: "Lecture A — filter pass",           note: "Tag ⭐ ❗. No heavy notes. Pre-learned = easy filter.", key: true },
      { time: fmtRange(l + dur, lecEnd),        label: "Lecture B — primary teaching",     note: "Engaged note-taking OK. No live unsuspends.", key: true },
      { time: fmtRange(lecEnd, lecEnd + 30),    label: "Old-lecture review",               note: "2–3 stalest. Self-test or rapid pull." },
      { time: fmtRange(lecEnd + 30, lecEnd + 60), label: "Break",                          note: "" },
      { time: fmtRange(lecEnd + 60, lecEnd + 210), label: "Targeted review + Anki unsuspend", note: "Fix Lec A ❗ tags. Deep-learn Lec B. ~20–30 cards/deck.", key: true },
      { time: fmtRange(lecEnd + 210, lecEnd + 240), label: "DLA (if pending)",             note: "Self-study. Slot one if due ≤5 days." },
      { time: fmtRange(lecEnd + 240, lecEnd + 330), label: "Dinner + life",               note: "Off." },
      { time: fmtRange(lecEnd + 330, lecEnd + 390), label: "Practice Qs",                 note: "Optional: 5–15 questions." },
      { time: fmtRange(lecEnd + 390, lecEnd + 450), label: "Wind-down",                   note: "Set tomorrow's must-dos. Screens off." },
      { time: fromMins(24 * 60),                label: "Sleep target",                    note: "", key: true },
    ];
  }

  if (mode === "review") return [
    { time: fmtRange(w, w + 30),        label: "Wake + Anki reviews",          note: "Mandatory. Cap 45 min if buried. No new unsuspends." },
    { time: fmtRange(w + 30, w + 150),  label: "Old-lecture review (deep)",    note: "3–5 stalest lectures. Self-test on pre-made deck.", key: true },
    { time: fmtRange(w + 150, w + 270), label: "Weak-concept drills",          note: "Pick 3 struggling objectives. Quiz, don't re-read.", key: true },
    { time: fmtRange(w + 270, w + 330), label: "Lunch",                        note: "Off." },
    { time: fmtRange(w + 330, w + 450), label: "Practice Qs block",            note: "15–30 questions. Review each miss.", key: true },
    { time: fmtRange(w + 450, w + 510), label: "Anki catch-up",                note: "Mature reviews + targeted unsuspends (filter-passed only)." },
    { time: fmtRange(w + 510, w + 540), label: "DLA (if pending)",             note: "Self-study. Slot one if overdue." },
    { time: fmtRange(w + 540, w + 650), label: "Dinner + life",                note: "Off." },
    { time: fmtRange(w + 650, w + 740), label: "Second review pass",           note: "Optional: 2 more stalest lectures or Q bank topic." },
    { time: fmtRange(w + 740, w + 800), label: "Wind-down",                    note: "Set tomorrow's must-dos. Screens off." },
    { time: fromMins(24 * 60),           label: "Sleep target",                 note: "", key: true },
  ];

  if (mode === "triage") {
    // Triage: lectures still happen — slot Anki + one thing around them
    const beforeLec = l > w + 105; // enough room for triage blocks pre-lecture
    if (beforeLec) return [
      { time: fmtRange(w, w + 45),          label: "Anki mature reviews",        note: "Non-negotiable. Zero new unsuspends.", key: true },
      { time: fmtRange(w + 45, l),          label: "One thing only",             note: "(a) skim 1 critical topic, (b) 20 practice Qs, or (c) 3 weak-concept drills.", key: true },
      { time: fmtRange(l, lecEnd),          label: "Lectures — light filter",    note: "Tag ⭐ ❗ only. Skip if recorded. No deep work." },
      { time: fmtRange(lecEnd, lecEnd + 60),label: "Reset + plan",               note: "RxTrack audit. Set tomorrow's must-dos.", key: true },
      { time: "23:00",                       label: "Bed — non-negotiable",       note: "Sleep is the recovery.", key: true },
    ];
    // Lectures first thing — do Anki + one thing after
    return [
      { time: fmtRange(l, lecEnd),          label: "Lectures — light filter",    note: "Tag ⭐ ❗ only. Skip if recorded." },
      { time: fmtRange(lecEnd, lecEnd + 45),label: "Anki mature reviews",        note: "Non-negotiable. Zero new unsuspends.", key: true },
      { time: fmtRange(lecEnd + 45, lecEnd + 105), label: "One thing only",      note: "(a) skim 1 critical topic, (b) 20 practice Qs, or (c) 3 weak-concept drills.", key: true },
      { time: fmtRange(lecEnd + 105, lecEnd + 165), label: "Reset + plan",       note: "RxTrack audit. Set tomorrow's must-dos.", key: true },
      { time: "23:00",                       label: "Bed — non-negotiable",       note: "Sleep is the recovery.", key: true },
    ];
  }

  return [];
}

/**
 * Optimized routine recovered from the Study Routine Optimization chat.
 * Every tool has one job: retain → expose → build → retrieve → apply →
 * repair → remediate → prepare. Travel and meals are real blocks, not gaps.
 */
export function computeSchedule(mode, wakeTime, lectureTime, lectureDuration, config = {}) {
  const w = toMins(wakeTime) ?? 6 * 60;
  const l = toMins(lectureTime) ?? 8 * 60;
  const dur = lectureDuration > 0 ? lectureDuration : 60;
  const lecEnd = l + dur * 2;
  const gym = toMins(config.gymTime) ?? 21 * 60;
  const leaveHome = toMins(config.leaveHomeTime) ?? 6 * 60 + 30;
  const smallGroup = config.smallGroup !== false;
  const block = (start, end, phase, label, note = "", key = false) => ({
    time: end == null ? fromMins(start) : fmtRange(start, end), start, end, phase, label, note, key,
  });

  if (mode === "lecture") {
    const retentionStart = Math.min(w + 15, leaveHome - 20);
    const retentionEnd = Math.max(retentionStart, leaveHome - 20);
    const arrival = leaveHome + 15;
    const morning = [
      block(w, w + 15, "RESET", "🌅 Wake + reset", "Water, bathroom, get moving."),
      ...(retentionEnd > retentionStart ? [block(retentionStart, retentionEnd, "RETAIN", "🔁 Anki — retention", `Due reviews only. ${Math.min(60, retentionEnd - retentionStart)} minutes available today; stop when it is time to leave.`, true)] : []),
      block(Math.max(w + 15, leaveHome - 20), leaveHome - 5, "RESET", "🍳 Breakfast + get ready", "Pack food and study materials."),
      block(leaveHome - 5, leaveHome, "TRAVEL", "🚶 Walk to bus stop"),
      block(leaveHome, arrival, "TRAVEL", "🚌 Travel to school", "Out-of-house anchor. No required studying."),
      ...(l - 20 > arrival ? [block(arrival, l - 20, "PREPARE", "📖 Light preview / overflow", "Objectives or leftover reviews. Do not introduce many new cards.")] : []),
      block(Math.max(arrival, l - 20), l, "RESET", "🚶 Settle into lecture", "Bathroom, water, seat, mental reset."),
      block(l, lecEnd, "EXPOSE", "🎓 Lectures ×2", "Listen for the story; do not transcribe slides.", true),
      block(lecEnd, lecEnd + 15, "TRAVEL", "🚶 Travel to study room", "Reset before active work."),
      block(lecEnd + 15, lecEnd + 45, "BUILD", "🧠 Build Lecture 1", "Skeleton → essential atoms. Park side trails.", true),
      block(lecEnd + 45, lecEnd + 75, "BUILD", "🧠 Build Lecture 2", "Skeleton → essential atoms. Explain the story."),
      block(lecEnd + 75, lecEnd + 135, "RETRIEVE", "🟦 Anki — acquisition", "Today's lecture cards, now attached to the models. Hard stop."),
      block(lecEnd + 135, lecEnd + 150, "TRAVEL", "🚶 Get lunch"),
      block(lecEnd + 150, lecEnd + 180, "RESET", "🍽️ Lunch", "Eat. Do not turn lunch into Anki."),
    ];

    if (smallGroup) return [
      ...morning,
      block(lecEnd + 180, lecEnd + 300, "EXPOSE", "👥 Small group / lab", "Required session when scheduled."),
      block(lecEnd + 300, lecEnd + 315, "TRAVEL", "🚶 Return to study room", "Decompress and reset."),
      block(lecEnd + 315, lecEnd + 375, "APPLY", "❓ Questions", "Today's + recent material. Starts even if Anki is unfinished.", true),
      block(lecEnd + 375, lecEnd + 420, "REPAIR", "🔬 Repair identified gaps", "Review misses → targeted video, drawing, or compare/contrast.", true),
      block(lecEnd + 420, lecEnd + 465, "REMEDIATE", "🟠 Anki — remediation", "Learning + Deep Review + buried remediation only."),
      block(lecEnd + 465, lecEnd + 495, "PREPARE", "👀 Tomorrow prep", "Objectives and required lab/small-group preparation only."),
      block(lecEnd + 495, gym - 25, "RESET", "🚌🍽️ Home, dinner + reset", "Travel counts. Academic work is finished."),
      block(gym - 25, gym, "TRAVEL", "🚶 Travel to gym"),
      block(gym, gym + 60, "RECOVER", "🏋️ Gym"),
      block(gym + 60, gym + 80, "TRAVEL", "🚶 Gym to home"),
      block(gym + 80, null, "RECOVER", "🚿 Wind down + sleep", "Protect the 5 AM wake-up.", true),
    ];

    return [
      ...morning,
      block(lecEnd + 180, lecEnd + 225, "APPLY", "❓ Questions", "Protected question block.", true),
      block(lecEnd + 225, lecEnd + 270, "REPAIR", "🔬 Review + repair", "Classify misses; repair only real model gaps."),
      block(lecEnd + 270, lecEnd + 315, "REMEDIATE", "🟠 Learning + Deep Review Anki", "Hard stop at 45 minutes."),
      block(lecEnd + 315, lecEnd + 360, "APPLY", "❓ Additional questions / understanding", "Apply again or finish targeted repair."),
      block(lecEnd + 360, lecEnd + 390, "PREPARE", "👀 Tomorrow prep", "15–30 minute scaffold only."),
      block(lecEnd + 390, gym - 25, "RECOVER", "Free time / early gym option", "Academic work can end earlier today."),
      block(gym - 25, gym, "TRAVEL", "🚶 Travel to gym"),
      block(gym, gym + 60, "RECOVER", "🏋️ Gym"),
      block(gym + 60, null, "RECOVER", "🚿 Home, wind down + sleep", "Protect the 5 AM wake-up.", true),
    ];
  }

  if (mode === "review") return [
    block(w, w + 15, "RESET", "🌅 Wake + reset"),
    block(w + 15, w + 75, "RETAIN", "🔁 Anki — retention", "Due reviews only. Hard stop at 60 minutes.", true),
    block(w + 75, w + 105, "RESET", "🍳 Breakfast + plan"),
    block(w + 105, w + 165, "APPLY", "❓ Cumulative questions", "Questions start before more Anki.", true),
    block(w + 165, w + 210, "REPAIR", "🔬 Review + repair", "Fact: retrieve once. Confusion: compare. Model gap: targeted repair."),
    block(w + 210, w + 255, "REMEDIATE", "🟠 Learning + Deep Review Anki", "Persistent and Again-heavy cards only."),
    block(w + 255, w + 300, "RESET", "🍽️ Lunch + reset"),
    block(w + 300, w + 345, "APPLY", "❓ Second question block", "Recent + weak objectives."),
    block(w + 345, w + 390, "BUILD", "🧠 Rebuild weakest model", "One mechanism map or teach-back—not broad rereading."),
    block(w + 390, w + 420, "PREPARE", "👀 Tomorrow prep", "Objectives, headings, diagrams, unfamiliar vocabulary."),
    block(w + 420, gym - 25, "RECOVER", "Life / dinner / recovery", "Stop when the plan is complete."),
    block(gym - 25, gym, "TRAVEL", "🚶 Travel to gym"),
    block(gym, gym + 60, "RECOVER", "🏋️ Gym"),
    block(gym + 60, null, "RECOVER", "🚿 Wind down + sleep", "Protect tomorrow's wake time.", true),
  ];

  if (mode === "triage") return [
    block(w, w + 15, "RESET", "🌅 Reset", "Today is recovery, not punishment."),
    block(w + 15, w + 60, "RETAIN", "🔁 Due Anki only", "Hard stop. Zero new unsuspends.", true),
    ...(lectureTime ? [block(l, lecEnd, "EXPOSE", "🎓 Required lectures", "Listen for the story; capture only major gaps.", true)] : []),
    block(Math.max(w + 60, lecEnd), Math.max(w + 60, lecEnd) + 30, "BUILD", "🧠 One essential mental model", "Choose the highest-yield lecture only."),
    block(Math.max(w + 60, lecEnd) + 30, Math.max(w + 60, lecEnd) + 60, "APPLY", "❓ 10–15 questions", "Protect application even on a bad day.", true),
    block(Math.max(w + 60, lecEnd) + 60, Math.max(w + 60, lecEnd) + 90, "REPAIR", "🔬 One major gap", "Only if questions exposed a real model failure."),
    block(Math.max(w + 60, lecEnd) + 90, null, "RECOVER", "Stop + recover", "Prereading and extra Anki are the first things dropped.", true),
  ];

  return computeLegacySchedule(mode, wakeTime, lectureTime, lectureDuration);
}

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

function DayModePicker({ mode, onChange, suggested }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {DAY_MODES.map((m) => {
        const isSelected = mode === m.id;
        const isSuggested = suggested === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={[
              "flex flex-col items-start rounded-sm border px-3 py-2.5 text-left transition-colors",
              isSelected
                ? "border-accent bg-panel text-text-1"
                : isSuggested
                  ? "border-accent/40 bg-bg-elevated text-text-2 hover:border-accent/60"
                  : "border-border bg-bg-elevated text-text-2 hover:border-border-strong",
            ].join(" ")}
          >
            <span className="flex items-center gap-1.5 font-condensed text-xs font-semibold uppercase tracking-wide">
              {(isSelected || isSuggested) && (
                <span
                  className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                  style={{ background: MODE_COLORS[m.id], opacity: isSelected ? 1 : 0.5 }}
                />
              )}
              {m.label}
              {isSuggested && !isSelected && (
                <span className="ml-auto font-mono text-[8px] text-text-3 normal-case tracking-normal">suggested</span>
              )}
            </span>
            <span className="mt-0.5 font-mono text-[12px] text-text-3 leading-snug normal-case tracking-normal">{m.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProgressBar({ done, total }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div>
      <div className="flex justify-between font-mono text-[12px] text-text-3 mb-1">
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

/**
 * Segmented coverage bar — sage/accent/amber fill, untested = remaining bg.
 * Color is never the sole signal: icon + label chips sit alongside it.
 */
function CoverageBar({ mastered = 0, inprogress = 0, struggling = 0, untested = 0 }) {
  const total = mastered + inprogress + struggling + untested;
  if (!total) return null;
  const w = (n) => `${(n / total * 100).toFixed(1)}%`;
  const allUntested = mastered === 0 && inprogress === 0 && struggling === 0;
  return (
    <div
      className="flex h-[5px] w-full overflow-hidden rounded-full"
      style={{ background: allUntested ? "var(--color-border-strong, var(--color-border))" : "var(--color-border)" }}
      role="img"
      aria-label={`${mastered} mastered, ${inprogress} learning, ${struggling} struggling, ${untested} untested`}
    >
      {mastered > 0 && (
        <div style={{ width: w(mastered), background: "var(--color-good)", flexShrink: 0 }} />
      )}
      {inprogress > 0 && (
        <div style={{ width: w(inprogress), background: "var(--color-accent)", flexShrink: 0 }} />
      )}
      {struggling > 0 && (
        <div style={{ width: w(struggling), background: "var(--color-warn)", flexShrink: 0 }} />
      )}
    </div>
  );
}

function RoundDots({ done, total }) {
  if (total <= 0) return null;
  return (
    <div className="flex items-center gap-1" title="Progress through today's recommended study passes">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={[
            "h-2 w-2 rounded-full transition-colors",
            i < done ? "bg-accent" : "bg-border",
          ].join(" ")}
        />
      ))}
      <span className="ml-1 font-mono text-[12px] text-text-3">{done} of {total} planned sessions today</span>
    </div>
  );
}


function ClassificationBadge({ wakeTime, mode }) {
  const suggested = wakeTimeMode(wakeTime);
  if (!suggested && !mode) return null;

  const effective = mode ?? suggested;
  if (!effective) return null;
  const modeName = DAY_MODES.find((m) => m.id === effective)?.label ?? effective;
  const isOverride = mode && suggested && mode !== suggested;

  const parts = [];
  if (wakeTime) {
    const h = parseInt(wakeTime.split(":")[0], 10);
    if (h < 8)       parts.push(`up ${wakeTime} → default`);
    else if (h < 10) parts.push(`up ${wakeTime} → compressed`);
    else             parts.push(`up ${wakeTime} → salvage`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
      <span className="text-text-3">{suggested ? "suggested" : "mode"}:</span>
      <span
        className="rounded px-1.5 py-0.5 font-bold text-bg text-[12px]"
        style={{ background: MODE_COLORS[effective] }}
      >
        {modeName}
      </span>
      {isOverride && <span className="text-text-3">(overriding suggestion)</span>}
      {parts.length > 0 && <span className="text-text-3">{parts.join(" · ")}</span>}
    </div>
  );
}

function RoutineSchedulePanel({ mode, wakeTime, lecConfig }) {
  const [collapsed, setCollapsed] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const blocks = computeSchedule(mode, wakeTime, lecConfig?.time, lecConfig?.duration, lecConfig);
  const nowMins = clock.getHours() * 60 + clock.getMinutes();
  if (!blocks.length) return null;
  return (
    <div className="rounded-sm border border-border bg-bg-elevated overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left"
      >
        <span className="font-condensed text-[12px] font-bold uppercase tracking-wider text-text-3">
          Today's routine
        </span>
        <span className="font-mono text-[12px] text-text-3">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border/40">
          {blocks.map((b, i) => (
            <div key={i}>
            {(i === 0 || blocks[i - 1]?.phase !== b.phase) && (
              <div className="border-b border-border/40 bg-bg px-3 py-1 font-condensed text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                {b.phase}
              </div>
            )}
            <div
              className={[
                "flex items-start gap-3 border-l-2 px-3 py-2 transition-colors",
                b.end != null && nowMins >= b.end ? "border-transparent opacity-50" :
                  nowMins >= b.start && (b.end == null || nowMins < b.end) ? "border-accent bg-accent-soft" :
                    b.key ? "border-transparent bg-panel/40" : "border-transparent",
              ].join(" ")}
            >
              <span className="w-[88px] flex-shrink-0 font-mono text-[13px] text-text-3 pt-0.5 leading-snug">{b.time}</span>
              <div className="flex-1 min-w-0">
                <div className={["text-[13px] leading-snug", b.key ? "font-semibold text-text-1" : "text-text-2"].join(" ")}>
                  {b.label}
                  {nowMins >= b.start && (b.end == null || nowMins < b.end) && (
                    <span className="ml-2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-bg">now</span>
                  )}
                </div>
                {b.note && <div className="font-mono text-[13px] text-text-3 mt-0.5 leading-snug">{b.note}</div>}
              </div>
            </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDaysAgo(n) {
  if (n < 0) return "recorded date is in the future";
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  return `${n}d ago`;
}
function fmtDaysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff}d`;
}

export function TaskRow({ task, checked, isNext, sessionCount, nextReviewDate, preRead, onCheck, onStudy, onQuiz, onLog, busy }) {
  const [logging, setLogging] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const title = task.lec?.lectureTitle || task.lec?.fileName || task.lec?.filename || "Lecture";
  const recommended = task.recommendedSessions || [];
  const targetRounds = recommended.length;
  const roundsDone = Math.min(sessionCount ?? 0, targetRounds);
  const partiallyDone = roundsDone > 0 && roundsDone < targetRounds;
  const hasObjectives = task.total > 0;

  return (
    <div
      className={[
        "desk-task rounded-sm border transition-all",
        checked
          ? "border-good/30 bg-good/5 opacity-60"
          : partiallyDone
            ? "border-accent/50 bg-panel"
            : isNext
              ? "border-accent/70 bg-accent-soft"
              : "border-border bg-bg-elevated hover:border-border-strong hover:bg-panel",
      ].join(" ")}
      data-next={isNext && !checked}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Checkbox */}
        <button
          onClick={() => onCheck(task.lec.id)}
          className={[
            "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border-[1.5px] transition-colors",
            checked
              ? "border-good bg-good text-bg"
              : partiallyDone
                ? "border-accent bg-accent/20 text-accent"
                : "border-text-3 hover:border-accent",
          ].join(" ")}
          aria-label={checked ? "Mark incomplete" : "Mark complete"}
        >
          {checked && <span className="text-[11px] font-bold leading-none">✓</span>}
          {!checked && partiallyDone && <span className="text-[11px] font-bold leading-none">~</span>}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {/* Row 1: title + actions */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {isNext && !checked && (
                <div className="mb-1 inline-flex items-center gap-1.5 rounded-sm bg-accent px-2 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-widest text-bg">
                  Up next
                </div>
              )}
              <div className="flex items-center gap-1">
                <button
                  className={[
                    "text-left text-base font-semibold leading-snug hover:underline",
                    checked ? "line-through text-text-3" : "text-text-1",
                  ].join(" ")}
                  onClick={() => !checked && onStudy(task.lec.id)}
                  title="Open lecture"
                >
                  {task.studyMode?.icon ? `${task.studyMode.icon} ` : ""}{title}
                </button>
                <button
                  onClick={() => setExpanded((e) => !e)}
                  className="min-h-7 min-w-7 px-1 text-sm text-text-3 hover:text-text-2"
                  title={expanded ? "Hide details" : "Show details"}
                  aria-expanded={expanded}
                >
                  {expanded ? "▴" : "▾"}
                </button>
              </div>
              <div className="mt-1 font-mono text-sm text-text-3">
                {task.availableDate
                  ? task.availableDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · "
                  : task.lec.weekNumber
                    ? `Wk ${task.lec.weekNumber}${task.lec.dayOfWeek ? ` · ${task.lec.dayOfWeek}` : ""} · `
                    : ""}
                {task.matchReason === "scheduled-day"
                  ? "on schedule"
                  : task.matchReason === "spaced-rep-due"
                    ? "spaced rep due"
                    : "highest urgency"}
                {preRead && (
                  <span className="text-good">
                    {" · pre-read ✓"}
                    {preRead.gapObjectiveIds?.length
                      ? ` ${preRead.gapObjectiveIds.length} gap${preRead.gapObjectiveIds.length === 1 ? "" : "s"} first`
                      : ""}
                  </span>
                )}
              </div>
            </div>

            {!checked && (
              <div className="flex flex-shrink-0 gap-1.5">
                <Button onClick={() => onStudy(task.lec.id)} title="Study rounds">Study →</Button>
                <Button variant="outline" onClick={() => onQuiz(task)} disabled={busy === task.lec.id}>
                  {busy === task.lec.id ? "…" : "Quiz"}
                </Button>
              </div>
            )}
          </div>

          {/* Row 2: segmented coverage bar + stat chips */}
          {hasObjectives && !checked && (
            <div className="flex flex-col gap-1">
              <CoverageBar
                mastered={task.mastered}
                inprogress={task.inprogress}
                struggling={task.struggling}
                untested={task.untested}
              />
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                {task.mastered > 0 && <span className="text-good">✓ {task.mastered} mastered</span>}
                {task.inprogress > 0 && <span className="text-accent">◑ {task.inprogress} learning</span>}
                {task.struggling > 0 && <span className="text-warn">⚠ {task.struggling} struggling</span>}
                {task.untested > 0 && (
                  <span className={task.mastered === 0 && task.inprogress === 0 && task.struggling === 0 ? "text-text-2" : "text-text-3"}>
                    ○ {task.untested} untested
                  </span>
                )}
              </div>
            </div>
          )}

          {/* One compact footer: review history, round progress, and secondary logging. */}
          {!checked && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-2 font-mono text-xs text-text-3">
              <div className="flex flex-wrap items-center gap-x-3">
                {task.sessions > 0 ? (
                  <>
                    <span>Reviewed {task.sessions}×</span>
                    {task.daysSinceLast != null && <span>last {fmtDaysAgo(task.daysSinceLast)}</span>}
                  </>
                ) : <span>Never reviewed</span>}
                {nextReviewDate && (
                  <span className={task.sessions === 0 ? "text-text-3" : "text-accent/80"}>
                    next {fmtDaysUntil(nextReviewDate)}
                  </span>
                )}
              </div>
              {targetRounds > 0 && <RoundDots done={roundsDone} total={targetRounds} />}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {logging ? (
                  <>
                    <span>How did {logging} go?</span>
                    {[{ key: "good", label: "Solid" }, { key: "okay", label: "OK" }, { key: "struggling", label: "Shaky" }].map((c) => (
                      <button
                        key={c.key}
                        onClick={() => { onLog(task.lec.id, logging, c.key); setLogging(null); }}
                        className="min-h-7 rounded border border-border px-2 text-text-2 hover:text-text-1"
                      >
                        {c.label}
                      </button>
                    ))}
                    <button onClick={() => setLogging(null)} className="min-h-7 px-1 hover:text-text-1" aria-label="Cancel logging">✕</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setLogging("anki")} className="min-h-7 hover:text-text-1">📇 Log Anki</button>
                    <button onClick={() => setLogging("review")} className="min-h-7 hover:text-text-1">✓ Log review</button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          {hasObjectives && (
            <div>
              <div className="mb-1.5 font-condensed text-[11px] font-bold uppercase tracking-widest text-text-3">
                Objectives
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px]">
                {task.mastered > 0 && <span className="text-good">✓ {task.mastered} mastered</span>}
                {task.inprogress > 0 && <span className="text-accent">◑ {task.inprogress} learning</span>}
                {task.struggling > 0 && <span className="text-warn">⚠ {task.struggling} struggling</span>}
                {task.untested > 0 && <span className="text-text-3">○ {task.untested} untested</span>}
              </div>
            </div>
          )}

          {recommended.length > 0 && (
            <div>
              <div className="mb-1.5 font-condensed text-[11px] font-bold uppercase tracking-widest text-text-3">
                Today's sessions
              </div>
              <div className="flex flex-col gap-1">
                {recommended.map((s, i) => (
                  <div
                    key={i}
                    className={[
                      "flex items-start gap-2 font-mono text-[12px]",
                      i < roundsDone ? "text-text-3 line-through" : "text-text-2",
                    ].join(" ")}
                  >
                    <span className="flex-shrink-0 text-text-3">{i + 1}.</span>
                    <div>
                      <span>{s.label}</span>
                      {s.reason && <span className="ml-1.5 text-[11px] text-text-3">— {s.reason}</span>}
                      {s.duration && <span className="ml-1.5 text-text-3">~{s.duration}m</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-text-3">
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

/**
 * Work Ahead — the lectures coming in the next two days, offered for pre-reading.
 *
 * `generateDailySchedule` has always computed these and no surface has ever
 * shown them, so being caught up looked identical to having nothing left to do.
 * Collapsed by default and hidden inside exam week (`workAhead.hidden`), but
 * always expandable: working ahead is a choice the app should never block.
 */
function WorkAheadSection({ workAhead, preReadFor, readyFor, onPreRead }) {
  // Auto-open follows the "nothing on fire" gate until you click, then your
  // choice wins — derived, so it tracks the gate without a sync effect.
  const [override, setOverride] = useState(null);
  const open = override ?? workAhead.expanded;

  if (!workAhead.lectures.length) return null;

  return (
    <div className="rounded-sm border border-border">
      <button
        onClick={() => setOverride(!open)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left"
      >
        <span className="font-condensed text-[13px] font-bold uppercase tracking-wide text-text-2">
          Work ahead · {workAhead.lectures.length} coming up
        </span>
        <span className="font-mono text-[12px] text-text-3">
          {workAhead.hidden
            ? "exam week — review first"
            : workAhead.backlog
              ? "clear your backlog first"
              : "you're caught up"}{" "}
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {workAhead.lectures.map((ls) => {
            const done = preReadFor?.(ls.lec.id);
            return (
              <div key={ls.lec.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-text-1">
                    {ls.studyMode?.icon} {ls.lec.lectureTitle || ls.lec.fileName || "Untitled lecture"}
                  </div>
                  <div className="font-mono text-[12px] text-text-3">
                    {/* The Date itself, never an ISO slice: availableDate is LOCAL
                        midnight, and toISOString() shifts it a day back west of
                        Greenwich — the same trap schedule.js documents. */}
                    {fmtDaysUntil(ls.availableDate)}
                    {done && ` · pre-read ✓ ${done.gapObjectiveIds?.length || 0} gaps`}
                    {!done && readyFor?.(ls.lec.id) && " · ready"}
                  </div>
                </div>
                <button
                  onClick={() => onPreRead(ls)}
                  className="shrink-0 rounded-sm border border-border px-2.5 py-1 font-condensed text-[13px] font-bold uppercase tracking-wide text-text-1"
                >
                  {done ? "Pre-read again" : "Pre-read"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
    <div className="rounded-sm border border-border bg-bg-elevated p-4">
      <div className="mb-1 font-condensed text-sm font-semibold uppercase tracking-wide text-text-1">Set exam date</div>
      <div className="mb-3 font-mono text-[12px] text-text-3">
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
  const { todayTasks, todayReason, nextDay, daily, study, examDate, daysLeft, logActivity, logPreRead, preReadFor, workAhead, objectivesForTask, nextReviewByLectureId } =
    useToday(blockId, userId);

  const [preReadTarget, setPreReadTarget] = useState(null);

  // Generate the offered pre-reads in the background so opening one is instant
  // — a first llm-bridge call runs ~35s, which is the whole session's worth of
  // patience spent before a single question appears.
  const { cachedFor } = usePreReadPrefetch(workAhead.lectures, {
    objectivesFor: objectivesForTask,
    userId,
    enabled: !workAhead.hidden,
  });

  const [dayMode, setDayMode] = useState(() => readDayMode(blockId));
  const [modePickerOpen, setModePickerOpen] = useState(() => !readDayMode(blockId));
  const [checked, setChecked] = useState(() => readChecked(blockId));
  const [sessionCounts, setSessionCounts] = useState(() => readSessionCounts(blockId));
  const [wakeTime, setWakeTime] = useState(() => readSleepWake(blockId).wakeTime ?? null);
  const [lecConfig, setLecConfig] = useState(() => readLecConfig(blockId));
  const [logFeedback, setLogFeedback] = useState(null);
  const [taskListCollapsed, setTaskListCollapsed] = useState(readTaskListCollapsed);

  const suggestedMode = useMemo(() => wakeTimeMode(wakeTime), [wakeTime]);

  // Sync when the Daily Plan Settings modal saves new values
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.blockId && e.detail.blockId !== blockId) return;
      setWakeTime(readSleepWake(blockId).wakeTime ?? null);
      setLecConfig(readLecConfig(blockId));
    };
    window.addEventListener("rxt-dayplan-settings-changed", handler);
    return () => window.removeEventListener("rxt-dayplan-settings-changed", handler);
  }, [blockId]);

  const handleDayMode = useCallback((m) => {
    setDayMode(m);
    writeDayMode(blockId, m);
    setModePickerOpen(false);
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

  // Auto-check when LectureStudyFlow reports ≥60% of rounds done
  useEffect(() => {
    function onProgress(e) {
      const { lectureId } = e.detail || {};
      if (!lectureId) return;
      setChecked((c) => {
        const ns = new Set(c);
        ns.add(lectureId);
        writeChecked(blockId, ns);
        return ns;
      });
    }
    window.addEventListener("rxt-lecture-progress-60", onProgress);
    return () => window.removeEventListener("rxt-lecture-progress-60", onProgress);
  }, [blockId]);

  const onStudy = useCallback((id) => {
    onStudyLecture?.(id);
    // Track session count for the round-dots UI only — do NOT auto-check here.
    // Checking happens when LectureStudyFlow reports ≥60% completion.
    setSessionCounts((prev) => {
      const next = { ...prev, [id]: (prev[id] ?? 0) + 1 };
      writeSessionCounts(blockId, next);
      return next;
    });
  }, [onStudyLecture, blockId]);

  const onQuiz = useCallback((task) => {
    const objectives = objectivesForTask(task.lec.id);
    const title = task.lec?.lectureTitle || task.lec?.fileName || "Lecture";
    // A pre-read's misses are the whole reason it exists: the first session after the lecture
    // opens on the objectives it exposed as gaps — passed through as a priority order for
    // Study's own quiz picker to apply, not pre-sorted here.
    const gapIds = preReadFor(task.lec.id)?.gapObjectiveIds || [];
    onStartObjectiveQuiz?.(objectives, title, blockId, { lectureId: task.lec.id, focusObjectiveIds: gapIds });
  }, [objectivesForTask, onStartObjectiveQuiz, blockId, preReadFor]);

  const onPreReadDone = useCallback(({ lectureId, gapObjectiveIds, durationMinutes }) => {
    const entry = logPreRead({ lectureId, gapObjectiveIds, durationMinutes });
    setLogFeedback(
      entry
        ? `Pre-read logged — ${gapObjectiveIds.length} gap${gapObjectiveIds.length === 1 ? "" : "s"} to listen for.`
        : "Could not log the pre-read."
    );
    setTimeout(() => setLogFeedback(null), 4000);
  }, [logPreRead]);

  // Effective mode: manual pick or auto-suggestion
  const effectiveMode = dayMode ?? suggestedMode;

  // Day mode filters the raw task list without touching the scheduler
  const filteredTasks = useMemo(() => {
    const mode = effectiveMode;
    if (!mode) return todayTasks;
    if (mode === "lecture") {
      const scheduled = todayTasks.filter((t) => t.matchReason === "scheduled-day");
      const due = todayTasks.filter((t) => t.matchReason === "spaced-rep-due").slice(0, 2);
      return [...scheduled, ...due];
    }
    if (mode === "review") {
      return todayTasks
        .filter((t) => t.matchReason !== "scheduled-day")
        .slice(0, 5);
    }
    if (mode === "triage") {
      const seen = todayTasks.filter((t) => (t.sessions ?? 0) > 0);
      const pool = seen.length >= 2 ? seen : todayTasks;
      return pool.slice(0, 2);
    }
    return todayTasks;
  }, [effectiveMode, todayTasks]);

  const doneCount = useMemo(() => filteredTasks.filter((t) => checked.has(t.lec.id)).length, [filteredTasks, checked]);
  const firstUnchecked = useMemo(() => filteredTasks.find((t) => !checked.has(t.lec.id))?.lec.id ?? null, [filteredTasks, checked]);

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  if (!examDate) {
    return <ExamDatePicker blockId={blockId} userId={userId} />;
  }

  return (
    <div className="desk-today flex flex-col gap-4">
      <ModelRetrievalCard key={`${userId}:${blockId}`} userId={userId} blockId={blockId} examDate={examDate} />
      {/* Header */}
      <div className="desk-day-heading flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[13px] text-text-3">{dateStr}</div>
          <div className="flex items-center gap-2">
            <h2 className="font-condensed text-xl font-bold uppercase tracking-wider text-text-1">Your study day</h2>
            <button
              onClick={() => {
                const next = !taskListCollapsed;
                setTaskListCollapsed(next);
                writeTaskListCollapsed(next);
              }}
              title={taskListCollapsed ? "Show task list" : "Hide task list"}
              aria-label={taskListCollapsed ? "Show task list" : "Hide task list"}
              className="text-text-3 hover:text-text-1 transition-colors"
            >
              <svg
                width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"
                className={`transition-transform ${taskListCollapsed ? "-rotate-90" : ""}`}
              >
                <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-sm border border-border bg-panel px-3 py-1 font-condensed text-[13px] font-bold uppercase tracking-wide text-text-2">
            {effectiveMode
              ? <><span className="inline-block mr-1.5 h-2 w-2 rounded-full align-middle" style={{ background: MODE_COLORS[effectiveMode] }} />{DAY_MODES.find((m) => m.id === effectiveMode)?.label}{!dayMode && <span className="ml-1 text-[13px] font-normal opacity-60">auto</span>}</>
              : "Set day type"
            }
          </span>
          <button onClick={() => setModePickerOpen((open) => !open)} className="font-mono text-[11px] text-text-3 hover:text-text-1">
            {modePickerOpen ? "hide modes" : "change mode"}
          </button>
          <span className="font-mono text-[12px] text-text-3">{daysLeft}d to exam</span>
        </div>
      </div>

      {/* Day mode picker */}
      {modePickerOpen && <DayModePicker mode={dayMode} onChange={handleDayMode} suggested={suggestedMode} />}

      {/* Progress */}
      {filteredTasks.length > 0 && (
        <ProgressBar done={doneCount} total={filteredTasks.length} />
      )}

      {logFeedback && (
        <div className="font-mono text-[12px] text-good">{logFeedback}</div>
      )}

      {/* Urgency fallback notice */}
      {todayReason === "urgency-fallback" && nextDay && (
        <div className="font-mono text-[12px] text-text-3">
          Nothing scheduled today — next session {nextDay.dateStr} ({nextDay.daysFromNow}d). Showing highest-urgency:
        </div>
      )}

      {/* Routine schedule for selected mode */}
      {effectiveMode && <RoutineSchedulePanel mode={effectiveMode} wakeTime={wakeTime} lecConfig={lecConfig} />}

      {/* Task list */}
      {!taskListCollapsed && (filteredTasks.length === 0 ? (
        todayTasks.length > 0 && effectiveMode ? (
          <div className="rounded-sm border border-border p-4 text-xs text-text-3">
            No tasks match <span className="text-text-1">{DAY_MODES.find((m) => m.id === effectiveMode)?.label}</span> today.
            {effectiveMode === "review" && " All available lectures are scheduled for today — switch to Lecture day."}
            {effectiveMode === "triage" && " No previously-studied lectures available — showing top pick below."}
          </div>
        ) : nextDay ? (
          <div className="rounded-sm border border-border p-4 text-xs text-text-3">
            Nothing due today. Block starts{" "}
            <span className="text-text-1">{nextDay.dateStr}</span> — {nextDay.daysFromNow} days away,{" "}
            {nextDay.tasks.length} lecture{nextDay.tasks.length === 1 ? "" : "s"}.
            <div className="mt-2 flex flex-col gap-0.5">
              {nextDay.tasks.slice(0, 4).map((t) => (
                <span key={t.lec.id} className="font-mono text-[12px]">
                  {t.studyMode?.icon} {t.lec.lectureTitle || t.lec.fileName || t.lec.filename}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-sm border border-border p-4 text-xs text-text-3">
            Nothing to do — every lecture is mastered or not yet available.
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {filteredTasks.map((task) => (
            <TaskRow
              key={task.lec.id}
              task={task}
              checked={checked.has(task.lec.id)}
              isNext={task.lec.id === firstUnchecked}
              sessionCount={sessionCounts[task.lec.id] ?? 0}
              nextReviewDate={nextReviewByLectureId?.[task.lec.id] ?? null}
              preRead={preReadFor(task.lec.id)}
              onCheck={handleCheck}
              onStudy={onStudy}
              onQuiz={onQuiz}
              onLog={onLog}
              busy={quizBusyLectureId}
            />
          ))}
        </div>
      ))}

      {/* Work ahead — pre-read what is coming */}
      <WorkAheadSection
        workAhead={workAhead}
        preReadFor={preReadFor}
        readyFor={(id) => {
          const lec = workAhead.lectures.find((l) => l.lec.id === id)?.lec;
          return lec ? !!cachedFor(lec, objectivesForTask(id)) : false;
        }}
        onPreRead={(ls) => setPreReadTarget(ls)}
      />

      {preReadTarget && (
        <PreReadModal
          lecture={preReadTarget.lec}
          userId={userId}
          objectives={objectivesForTask(preReadTarget.lec.id)}
          cached={cachedFor(preReadTarget.lec, objectivesForTask(preReadTarget.lec.id))}
          onClose={() => setPreReadTarget(null)}
          onComplete={onPreReadDone}
        />
      )}

      <BlockPracticeCard blockId={blockId} userId={userId} />

      {/* Reset */}
      {doneCount > 0 && (
        <button
          onClick={() => { setChecked(new Set()); writeChecked(blockId, new Set()); }}
          className="self-start font-mono text-[12px] text-text-3 hover:text-text-1"
        >
          Reset checks
        </button>
      )}
    </div>
  );
}

export default Today;
