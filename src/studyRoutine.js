/**
 * Study Routine — personal, account-linked, adaptive.
 *
 * Pure logic module. Reads existing localStorage signals (calibration log,
 * rxt-completion activity log, rxt-learning-profile session history,
 * weak concepts) plus two new keys (`rxt-study-routine`, `rxt-miss-notes`,
 * `rxt-weak-drills`) to evaluate today's routine progress and surface
 * suggestions based on the last ~14 days of behavior.
 *
 * Storage keys are registered in src/supabase.js KV_KEYS so they sync
 * via user_kv. No React, no DOM beyond a custom event dispatch.
 */

import { getCalibrationStats, CALIBRATION_BUCKETS } from "./calibration";
import { getCurrentUser, scheduleDebouncedCloudPush } from "./supabase";

export const ROUTINE_KEY = "rxt-study-routine";
export const MISS_NOTES_KEY = "rxt-miss-notes";
export const WEAK_DRILLS_KEY = "rxt-weak-drills";

const ROUTINE_VERSION = 1;
const MAX_MISS_NOTES = 1000;
const MAX_WEAK_DRILLS = 1000;

/* ─────────────────────────── default routine ────────────────────────── */

export function getDefaultRoutine() {
  const now = new Date().toISOString();
  return {
    version: ROUTINE_VERSION,
    steps: [
      {
        id: "calibration-warmup",
        title: "Calibration warm-up",
        when: "morning",
        target: 5,
        kind: "calibration-count",
        description: "5 MCQs from yesterday's weak concepts using 50/70/90% confidence",
      },
      {
        id: "preview-objectives",
        title: "Preview today's objectives",
        when: "pre-lecture",
        target: 1,
        kind: "activity",
        activityTypes: ["preview"],
        description: "Skim the objectives for today's lecture before watching",
      },
      {
        id: "lecture-block",
        title: "Lecture + 5-min recall blurt",
        when: "lecture",
        target: 1,
        kind: "activity",
        activityTypes: ["lecture", "deep_learn", "review"],
        description: "Watch the lecture, then write everything you remember",
      },
      {
        id: "qbank",
        title: "Qbank questions",
        when: "qbank",
        target: 30,
        kind: "session-history",
        description: "30–40 Qbank-style questions with confidence picker",
      },
      {
        id: "weak-drill",
        title: "Drill 3 struggling concepts",
        when: "drill",
        target: 3,
        kind: "weak-drill",
        description: "Hit 3 different struggling weak concepts in DeepLearn MCQ",
      },
      {
        id: "evening-misses",
        title: "Note today's misses",
        when: "evening",
        target: 1,
        kind: "miss-notes",
        description: "Add a 1-line 'why I missed it' on each wrong answer",
      },
    ],
    weekly: {
      id: "weekly-audit",
      title: "Calibration & weak-list audit",
      target: 1,
      description: "Review 50/70/90 buckets; run Backfill objective links if needed",
    },
    acceptedSuggestionIds: [],
    dismissedSuggestions: {}, // { [id]: { dismissedAt, snoozeUntilISO? } }
    lastWeeklyReviewAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/* ─────────────────────────── persistence ────────────────────────────── */

export function loadRoutine() {
  try {
    const raw = localStorage.getItem(ROUTINE_KEY);
    if (!raw) return getDefaultRoutine();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return getDefaultRoutine();
    // Forward-compat: re-default if version drifts.
    if (parsed.version !== ROUTINE_VERSION) {
      const fresh = getDefaultRoutine();
      return {
        ...fresh,
        acceptedSuggestionIds: parsed.acceptedSuggestionIds || [],
        dismissedSuggestions: parsed.dismissedSuggestions || {},
        lastWeeklyReviewAt: parsed.lastWeeklyReviewAt || null,
      };
    }
    return parsed;
  } catch {
    return getDefaultRoutine();
  }
}

export function saveRoutine(routine) {
  try {
    const next = { ...routine, updatedAt: new Date().toISOString() };
    localStorage.setItem(ROUTINE_KEY, JSON.stringify(next));
    try {
      window.dispatchEvent(new CustomEvent("rxt-routine-updated"));
    } catch {}
    getCurrentUser()
      .then((user) => { if (user?.id) scheduleDebouncedCloudPush(user.id); })
      .catch(() => {});
    return next;
  } catch (e) {
    console.error("saveRoutine failed:", e);
    return routine;
  }
}

export function resetRoutineToDefault() {
  return saveRoutine(getDefaultRoutine());
}

export function setStepTarget(stepId, target) {
  const r = loadRoutine();
  const steps = (r.steps || []).map((s) => (s.id === stepId ? { ...s, target } : s));
  return saveRoutine({ ...r, steps });
}

/* ───────────────── miss-notes & weak-drill instrumentation ──────────── */

function loadArrayKey(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveArrayKey(key, arr, max) {
  try {
    const trimmed = arr.length > max ? arr.slice(-max) : arr;
    localStorage.setItem(key, JSON.stringify(trimmed));
    getCurrentUser()
      .then((user) => { if (user?.id) scheduleDebouncedCloudPush(user.id); })
      .catch(() => {});
  } catch (e) {
    console.error(`save ${key} failed:`, e);
  }
}

export function addMissNote({ wcId, sourceQuestionDate = null, note }) {
  const trimmed = String(note || "").trim();
  if (!trimmed) return null;
  const log = loadArrayKey(MISS_NOTES_KEY);
  const entry = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `mn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    wcId: wcId || null,
    sourceQuestionDate: sourceQuestionDate || null,
    note: trimmed.slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  log.push(entry);
  saveArrayKey(MISS_NOTES_KEY, log, MAX_MISS_NOTES);
  try {
    window.dispatchEvent(new CustomEvent("rxt-miss-notes-updated"));
  } catch {}
  return entry;
}

export function recordWeakDrill({ conceptId, blockId = null }) {
  if (!conceptId) return;
  const log = loadArrayKey(WEAK_DRILLS_KEY);
  log.push({
    conceptId,
    blockId,
    at: new Date().toISOString(),
  });
  saveArrayKey(WEAK_DRILLS_KEY, log, MAX_WEAK_DRILLS);
  try {
    window.dispatchEvent(new CustomEvent("rxt-weak-drills-updated"));
  } catch {}
}

/* ─────────────────────────── date helpers ───────────────────────────── */

function todayPrefix(todayISO) {
  if (todayISO) return String(todayISO).slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n, todayISO) {
  const base = todayISO ? new Date(todayISO) : new Date();
  base.setUTCDate(base.getUTCDate() - n);
  return base.toISOString();
}

function isSameDay(iso, dayPrefix) {
  return String(iso || "").slice(0, 10) === dayPrefix;
}

/* ─────────────────────────── signal readers ─────────────────────────── */

function readCalibrationLog() {
  return loadArrayKey("rxt-calibration-log");
}

function readMissNotes() {
  return loadArrayKey(MISS_NOTES_KEY);
}

function readWeakDrillLog() {
  return loadArrayKey(WEAK_DRILLS_KEY);
}

function readSessionHistory() {
  try {
    const raw = localStorage.getItem("rxt-learning-profile");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.sessionHistory) ? parsed.sessionHistory : [];
  } catch {
    return [];
  }
}

function readCompletionEntries() {
  try {
    const raw = localStorage.getItem("rxt-completion");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    return Object.values(parsed).filter((e) => e && Array.isArray(e.activityLog));
  } catch {
    return [];
  }
}

function readWeakConcepts() {
  try {
    const raw = localStorage.getItem("rxt-weak-concepts");
    if (!raw) return { all: [], byBlock: {}, lifetime: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { all: [], byBlock: {}, lifetime: [] };
    const lifetime = Array.isArray(parsed.lifetime) ? parsed.lifetime : [];
    const byBlock = {};
    const all = [...lifetime];
    for (const k of Object.keys(parsed)) {
      if (k === "lifetime") continue;
      if (Array.isArray(parsed[k])) {
        byBlock[k] = parsed[k];
        all.push(...parsed[k]);
      }
    }
    return { all, byBlock, lifetime };
  } catch {
    return { all: [], byBlock: {}, lifetime: [] };
  }
}

/* ───────────────────────── per-step evaluation ──────────────────────── */

function evaluateStep(step, ctx) {
  const { todayPrefix: today } = ctx;
  switch (step.kind) {
    case "calibration-count": {
      const value = ctx.calibration.filter((e) => isSameDay(e.date, today)).length;
      return { value, done: value >= (step.target || 1) };
    }
    case "activity": {
      const wanted = new Set(step.activityTypes || []);
      const value = ctx.completionEntries.reduce((sum, entry) => {
        const matches = (entry.activityLog || []).filter(
          (a) => wanted.has(a?.activityType) && isSameDay(a?.date, today)
        ).length;
        return sum + matches;
      }, 0);
      return { value, done: value >= (step.target || 1) };
    }
    case "session-history": {
      const value = ctx.sessionHistory.filter((e) => isSameDay(e.at, today)).length;
      return { value, done: value >= (step.target || 1) };
    }
    case "weak-drill": {
      const fromLog = ctx.weakDrills
        .filter((e) => isSameDay(e.at, today))
        .map((e) => e.conceptId)
        .filter(Boolean);
      const fromMissed = ctx.weakConcepts.all
        .filter((c) => isSameDay(c?.lastMissed, today))
        .map((c) => c.id)
        .filter(Boolean);
      const value = new Set([...fromLog, ...fromMissed]).size;
      return { value, done: value >= (step.target || 1) };
    }
    case "miss-notes": {
      const value = ctx.missNotes.filter((n) => isSameDay(n.createdAt, today)).length;
      return { value, done: value >= (step.target || 1) };
    }
    default:
      return { value: 0, done: false };
  }
}

function buildCtx(todayISO) {
  return {
    todayPrefix: todayPrefix(todayISO),
    calibration: readCalibrationLog(),
    completionEntries: readCompletionEntries(),
    sessionHistory: readSessionHistory(),
    weakDrills: readWeakDrillLog(),
    weakConcepts: readWeakConcepts(),
    missNotes: readMissNotes(),
  };
}

export function evaluateToday({ routine, todayISO } = {}) {
  const r = routine || loadRoutine();
  const ctx = buildCtx(todayISO);
  const steps = (r.steps || []).map((step) => {
    const { value, done } = evaluateStep(step, ctx);
    return {
      stepId: step.id,
      title: step.title,
      when: step.when,
      target: step.target,
      value,
      done,
      label: `${value} / ${step.target}`,
    };
  });
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, totalCount: steps.length };
}

/* ─────────────────────── multi-day helpers (rules) ──────────────────── */

function evaluateOnDay(routine, dayISO) {
  const dayPrefix = String(dayISO).slice(0, 10);
  // Re-use evaluateStep but with a ctx whose todayPrefix is dayPrefix.
  const ctx = {
    todayPrefix: dayPrefix,
    calibration: readCalibrationLog(),
    completionEntries: readCompletionEntries(),
    sessionHistory: readSessionHistory(),
    weakDrills: readWeakDrillLog(),
    weakConcepts: readWeakConcepts(),
    missNotes: readMissNotes(),
  };
  const map = {};
  for (const step of routine.steps || []) {
    map[step.id] = evaluateStep(step, ctx).done;
  }
  return map;
}

function daysDoneInLastN(routine, stepId, n, todayISO) {
  let count = 0;
  for (let i = 0; i < n; i++) {
    const day = daysAgoISO(i, todayISO);
    const map = evaluateOnDay(routine, day);
    if (map[stepId]) count++;
  }
  return count;
}

/* ─────────────────────────── suggestion rules ───────────────────────── */

const SUGGESTION_RULES = [
  /* 1 — overconfidence on 90% bucket */
  function overconfidence({ todayISO }) {
    const sinceISO = daysAgoISO(14, todayISO);
    const stats = getCalibrationStats({ sinceISO });
    const ninety = stats[90];
    if (!ninety || ninety.n < 10 || ninety.gap == null) return null;
    if (ninety.gap >= -10) return null;
    return {
      id: "overconfidence-90",
      kind: "advisory",
      message: `Overconfident on 90% (${ninety.accuracy}% actual, ${ninety.gap}). Try a 10-second "explain out loud" before submitting 90%-confidence answers.`,
    };
  },
  /* 2 — drill consistency (step 5 done < 3/7) */
  function drillConsistency({ routine, todayISO }) {
    const days = daysDoneInLastN(routine, "weak-drill", 7, todayISO);
    if (days >= 3) return null;
    return {
      id: "drill-consistency",
      kind: "advisory",
      message: `Weak-concept drill hit only ${days} of the last 7 days. Try moving it before Qbank — earlier slots stick better.`,
    };
  },
  /* 3 — Qbank target miss (step 4 done < 4/7) */
  function qbankTargetMiss({ routine, todayISO }) {
    const days = daysDoneInLastN(routine, "qbank", 7, todayISO);
    if (days >= 4) return null;
    const qbankStep = (routine.steps || []).find((s) => s.id === "qbank");
    const current = qbankStep?.target || 30;
    if (current <= 20) return null; // already at floor
    return {
      id: "qbank-target-floor",
      kind: "target-edit",
      stepId: "qbank",
      proposedTarget: 20,
      message: `Qbank target hit only ${days} of last 7 days. Drop daily target ${current}→20 until you hold it 5 days, then restore.`,
    };
  },
  /* 4 — unlinked concepts > 20 */
  function unlinkedConcepts() {
    const { all } = readWeakConcepts();
    const unlinked = all.filter(
      (c) => !Array.isArray(c.objectiveIds) || c.objectiveIds.length === 0
    );
    if (unlinked.length <= 20) return null;
    return {
      id: "backfill-objective-links",
      kind: "action",
      action: "open-backfill",
      message: `${unlinked.length} weak concepts have no objective links. Run "Backfill" from the Weak Concepts tab.`,
    };
  },
  /* 5 — mastery drift: a "mastered" objective generated a miss this week */
  function masteryDrift({ todayISO }) {
    const sinceISO = daysAgoISO(7, todayISO);
    const calibration = readCalibrationLog();
    const recentMissObjIds = new Set(
      calibration
        .filter((e) => e.date >= sinceISO && e.correct === false && e.objectiveId)
        .map((e) => e.objectiveId)
    );
    if (recentMissObjIds.size === 0) return null;

    let drifted = [];
    try {
      const stored = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
      const collect = (obj) => {
        if (!obj) return;
        if (Array.isArray(obj)) {
          obj.forEach(collect);
          return;
        }
        if (typeof obj !== "object") return;
        if (obj.id != null && obj.status === "mastered" && recentMissObjIds.has(obj.id)) {
          drifted.push(obj);
          return;
        }
        for (const v of Object.values(obj)) collect(v);
      };
      collect(stored);
    } catch {}
    if (drifted.length === 0) return null;
    const sample = drifted[0];
    const label = sample.objective || sample.text || "an objective";
    return {
      id: `mastery-drift-${sample.id}`,
      kind: "advisory",
      message: `Mastery drift: ${drifted.length === 1 ? "" : `${drifted.length} mastered objectives have new misses — e.g. `}"${String(label).slice(0, 80)}". Re-add to this week's targeted drill.`,
    };
  },
];

function notDismissed(routine, suggestion, todayISO) {
  const dismissed = (routine.dismissedSuggestions || {})[suggestion.id];
  if (!dismissed) return true;
  if (!dismissed.snoozeUntilISO) return false; // permanently dismissed
  const today = todayISO || new Date().toISOString();
  return today >= dismissed.snoozeUntilISO;
}

export function getSuggestions({ routine, todayISO } = {}) {
  const r = routine || loadRoutine();
  const suggestions = [];
  for (const rule of SUGGESTION_RULES) {
    try {
      const s = rule({ routine: r, todayISO });
      if (s && notDismissed(r, s, todayISO)) suggestions.push(s);
    } catch (e) {
      console.error("suggestion rule failed:", e);
    }
  }
  return suggestions;
}

/* ─────────────────────── suggestion mutations ───────────────────────── */

export function dismissSuggestion(id, { snoozeDays = null } = {}) {
  const r = loadRoutine();
  const dismissedAt = new Date().toISOString();
  let snoozeUntilISO = null;
  if (snoozeDays && snoozeDays > 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + snoozeDays);
    snoozeUntilISO = d.toISOString();
  }
  return saveRoutine({
    ...r,
    dismissedSuggestions: {
      ...(r.dismissedSuggestions || {}),
      [id]: { dismissedAt, snoozeUntilISO },
    },
  });
}

export function acceptSuggestion(suggestion) {
  const r = loadRoutine();
  let next = { ...r };
  if (suggestion.kind === "target-edit" && suggestion.stepId && suggestion.proposedTarget) {
    next.steps = (r.steps || []).map((s) =>
      s.id === suggestion.stepId ? { ...s, target: suggestion.proposedTarget } : s
    );
  }
  next.acceptedSuggestionIds = Array.from(
    new Set([...(r.acceptedSuggestionIds || []), suggestion.id])
  );
  // Acceptance also dismisses (no snooze) so we don't re-show.
  next.dismissedSuggestions = {
    ...(r.dismissedSuggestions || {}),
    [suggestion.id]: { dismissedAt: new Date().toISOString(), snoozeUntilISO: null },
  };
  return saveRoutine(next);
}

export function markWeeklyReviewDone() {
  const r = loadRoutine();
  return saveRoutine({ ...r, lastWeeklyReviewAt: new Date().toISOString() });
}

export function getWeeklyStatus({ routine, todayISO } = {}) {
  const r = routine || loadRoutine();
  if (!r.lastWeeklyReviewAt) return { done: false, daysSince: null };
  const last = new Date(r.lastWeeklyReviewAt).getTime();
  const now = todayISO ? new Date(todayISO).getTime() : Date.now();
  const daysSince = Math.floor((now - last) / (24 * 60 * 60 * 1000));
  return { done: daysSince < 7, daysSince };
}

// re-export for UI consumers
export { CALIBRATION_BUCKETS };
