import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTheme } from "./theme";
import { recordWrongAnswer } from "./weakConcepts";

// ── Storage ───────────────────────────────────────────────
function sGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function sSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

/** Spacing for next review after a log (used when syncing `rxt-tracker-v2`). */
function getNextReviewDate(sessionCount, rating) {
  const days =
    rating === "struggling"
      ? 1
      : sessionCount <= 1
        ? 3
        : sessionCount <= 2
          ? 7
          : sessionCount <= 3
            ? 14
            : 30;
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

/** Same study-coach pipeline as App `getStudyCoachSteps`, but perf/completion come from React state (not LS reads). */
function computeStudyCoachSteps(lec, blockId, perf, completion, getBlockObjectives) {
  const objText = (o) => (o.objective || o.text || "").trim();
  try {
    const objs =
      blockId && lec?.id && typeof getBlockObjectives === "function"
        ? (getBlockObjectives(blockId) || []).filter((o) => o.linkedLecId === lec.id)
        : [];

    const perfKey = `${lec.id}__${blockId}`;
    const lecPerf = perf[perfKey];
    const lecComp = completion[perfKey];
    const sessionCount = lecComp?.sessionCount || lecPerf?.sessions?.length || 0;
    const lastScore = lecPerf?.score || 0;

    const masteredObjs = objs.filter((o) => (o.consecutiveCorrect || 0) >= 3).length;
    const strugglingObjs = objs.filter((o) => o.status === "struggling");
    const masteryPct = objs.length > 0 ? masteredObjs / objs.length : 0;

    const allSteps = [
      {
        id: "prime",
        phase: 1,
        number: 1,
        icon: "🧠",
        title: "Prime your brain first",
        subtitle: "Before touching any material",
        color: "#dc2626",
        description: `Before you open any slides or watch any video, take 2 minutes and write down everything you already know about "${lec?.lectureTitle || "this lecture"}". Don't worry if it's nothing — that's normal. This primes your brain to absorb new information better.`,
        howTo: [
          "Open a blank note or grab paper",
          "Set a 2-minute timer",
          "Write everything you know about this topic — no peeking",
          "Then start Deep Learn below",
        ],
        whyItWorks: `Pre-testing yourself before learning — even when you know nothing — improves encoding by up to 50%. Your brain forms stronger connections when it has existing hooks to attach new information to.`,
        action: "deep_learn",
        actionLabel: "🧠 Start Deep Learn",
        done: sessionCount >= 1,
        skippable: false,
      },
      {
        id: "encode",
        phase: 1,
        number: 2,
        icon: "📖",
        title: "Encode — understand it first",
        subtitle: "Watch, listen, or use Deep Learn",
        color: "#dc2626",
        description: `Now engage with the material actively. You can watch a Ninja Nerd video on this topic, attend/re-watch the lecture, or use Deep Learn below. The key: every 5-10 minutes, PAUSE and recall what you just learned before continuing. Don't just let it play.`,
        howTo: [
          "Option A: Watch a Ninja Nerd video on this topic",
          "Option B: Use Deep Learn — guided teaching per objective (Prime → Learn → Patient → Self-test → Gaps → Apply)",
          "Option C: Attend or re-watch the lecture recording",
          "⚠ Every 5-10 min: pause and write what you just learned",
          "Log your activity below when done",
        ],
        whyItWorks: `Passive watching or reading produces poor retention. Pausing to recall every few minutes (the "pause-and-recall" method) is 2-3x more effective than continuous watching. Active engagement forces your brain to process, not just receive.`,
        action: "deep_learn",
        actionLabel: "🧠 Deep Learn",
        done: sessionCount >= 1,
        skippable: false,
      },
      {
        id: "feynman",
        phase: 2,
        number: 3,
        icon: "💬",
        title: "Explain it back — Feynman check",
        subtitle: "If you can't explain it simply, you don't know it yet",
        color: "#d97706",
        description: `Close everything. Pick any 2-3 objectives from this lecture and explain them out loud as if teaching a friend with no medical background. Where you stumble or go blank = exactly what you don't actually know yet. Go back and fill those gaps before moving on.`,
        howTo: [
          "Close your notes and the app",
          "Pick 2-3 objectives from the list below",
          "Explain each one out loud or in writing — simple language",
          "Notice where you get stuck or vague",
          "Those gaps = go back to Encode (Step 2) — use Deep Learn's Learn phase for those objectives only, not the whole lecture",
        ],
        whyItWorks: `The Feynman technique exposes the gap between "I recognize this" and "I actually understand this." Most students discover this gap on exam day. You want to find it now.`,
        action: "drill",
        actionLabel: "⚡ Self-test with Drill",
        done: sessionCount >= 2 || lastScore >= 70,
        skippable: true,
      },
      {
        id: "retrieve",
        phase: 2,
        number: 4,
        icon: "⚡",
        title: "Retrieval practice — test yourself",
        subtitle: "This IS the studying, not preparation for studying",
        color: "#d97706",
        description: `Now test yourself on every objective without notes. This is the single most important step — research shows retrieval practice produces 50-80% better long-term retention than re-studying. Mark each objective: mastered, getting there, or struggling. Your goal is to find your gaps, not to feel good.`,
        howTo: [
          "Click Drill below",
          "Answer each objective without looking at notes",
          "Be honest — mark struggling if you're not sure",
          "Struggling objectives automatically get flagged for extra practice",
          `Aim for at least one full pass through all ${objs.length} objectives`,
        ],
        whyItWorks: `Every time you successfully retrieve a memory, the memory trace strengthens. Every time you fail to retrieve it, you identify exactly what to study. Both outcomes are useful. Re-reading feels productive but produces 50% less retention than testing yourself.`,
        action: "drill",
        actionLabel: "⚡ Start Drill",
        done: objs.some((o) => (o.drillCount || 0) > 0),
        skippable: false,
      },
      {
        id: "gaps",
        phase: 2,
        number: 5,
        icon: "🔍",
        title: "Fix your gaps",
        subtitle:
          strugglingObjs.length > 0
            ? `${strugglingObjs.length} objectives need work`
            : "Almost there — clean up remaining weak spots",
        color: "#7c3aed",
        description:
          strugglingObjs.length > 0
            ? `You have ${strugglingObjs.length} struggling objectives. Go back to Deep Learn and redo Guided Teaching / Gaps for THOSE OBJECTIVES ONLY — don't re-read everything. Then drill again until they're solid. Focused restudy of weak areas is 3x more efficient than reviewing everything.`
            : `Run one more drill pass. Your goal is to get every objective to at least "getting there" before moving to clinical questions.`,
        howTo:
          strugglingObjs.length > 0
            ? [
                `Focus only on: ${strugglingObjs
                  .slice(0, 3)
                  .map((o) => objText(o).slice(0, 40))
                  .join(", ")}`,
                "Open Deep Learn → Learn phase for those objectives only",
                "Or watch the part of the video covering that topic",
                "Then drill again — just those objectives",
              ]
            : [
                "Run another drill pass",
                'Focus on objectives you rated "getting there"',
                "Repeat until all objectives feel solid",
              ],
        whyItWorks: `Targeted restudy of weak areas is far more efficient than re-reading everything. Identify your exact gaps and fill only those.`,
        action: strugglingObjs.length > 0 ? "deep_learn" : "drill",
        actionLabel: strugglingObjs.length > 0 ? "🧠 Review weak sections" : "⚡ Drill again",
        done: strugglingObjs.length === 0 && objs.every((o) => (o.drillCount || 0) > 0),
        skippable: true,
      },
      {
        id: "quiz",
        phase: 3,
        number: 6,
        icon: "📝",
        title: "Apply it — clinical questions",
        subtitle: "Study in the format you'll be tested in",
        color: "#0891b2",
        description: `Now that you know the material, practice applying it to patient scenarios — exactly how your exam will test you. Clinical vignette questions force you to USE the knowledge, not just recognize it. Wrong answers include explanations of WHY they're wrong, which is often more valuable than the correct answer.`,
        howTo: [
          "Click Quiz below",
          "Choose 10 questions to start",
          "Read each option carefully — don't rush",
          "After answering, read ALL the wrong answer explanations",
          "The teaching points are high yield — read every one",
        ],
        whyItWorks: `Transfer-appropriate processing: practicing in the exact format of your exam produces significantly better performance than studying in any other format. Clinical vignettes also force you to connect mechanisms to outcomes — exactly what Step 1 tests.`,
        action: "quiz",
        actionLabel: "📝 Start Quiz",
        done: lastScore >= 80,
        skippable: false,
      },
      {
        id: "connect",
        phase: 3,
        number: 7,
        icon: "🔗",
        title: "Connect to other lectures",
        subtitle: "Build the bigger picture",
        color: "#0891b2",
        description: `Ask yourself: how does this lecture connect to what you've already learned? How might ${lec?.lectureTitle || "this lecture"} come up in the same patient case as other lectures? Cross-lecture connections are what Step 1 actually tests — not isolated facts.`,
        howTo: [
          "Think: what concepts from other lectures relate to this one?",
          "Quiz yourself with cross-objective questions",
          "Try to create a 1-sentence connection between this lecture and one other",
        ],
        whyItWorks: `Elaborative interrogation — asking "how does this connect?" — is one of the highest-yield encoding strategies. Isolated facts fade. Connected knowledge persists.`,
        action: "quiz",
        actionLabel: "📝 Cross-lecture Quiz",
        done: lastScore >= 85 && masteryPct >= 0.7,
        skippable: true,
      },
      {
        id: "spaced",
        phase: 4,
        number: 8,
        icon: "📅",
        title: "Space it out — come back later",
        subtitle: "Review in 3 days, then 7, then 14",
        color: "#16a34a",
        description: `You're done for now. Come back in 3 days and do a quick 5-minute drill. If you score 80%+, wait 7 days before the next review. Each successful review doubles the interval. This is how you build knowledge that lasts until the exam — and beyond.`,
        howTo: [
          "The app will remind you when this lecture is due for review",
          "When it appears in Reviews Due — just do a quick drill",
          "If score drops below 80% — go back to Fix gaps (Step 5)",
          "If score stays above 80% — move the interval further out",
        ],
        whyItWorks: `The spacing effect is the most well-replicated finding in memory research. Reviewing at increasing intervals is 2-3x more efficient than massed practice (cramming). One hour spread over 3 sessions beats 3 hours in one sitting.`,
        action: "drill",
        actionLabel: "📅 Quick Review Drill",
        done: masteryPct >= 0.8 && sessionCount >= 3,
        skippable: false,
      },
    ];

    const currentStepIdx = allSteps.findIndex((s) => !s.done);
    const currentStep = allSteps[currentStepIdx] || allSteps[allSteps.length - 1];

    return {
      steps: allSteps,
      currentStep,
      currentStepIdx: currentStepIdx === -1 ? allSteps.length - 1 : currentStepIdx,
      totalSteps: allSteps.length,
      completedSteps: allSteps.filter((s) => s.done).length,
    };
  } catch {
    const stub = {
      phase: 1,
      icon: "🧠",
      title: "Prime your brain first",
      subtitle: "Before touching any material",
      color: "#dc2626",
      description: "Before you start, write down what you already know about this lecture.",
      howTo: ["Open a blank note", "Set a 2-minute timer", "Write what you know — no peeking", "Then start Deep Learn"],
      whyItWorks: "Retrieval practice before learning improves encoding.",
      action: "deep_learn",
      actionLabel: "🧠 Start Deep Learn",
      done: false,
      skippable: false,
    };
    const steps = Array.from({ length: 8 }, (_, i) => ({
      ...stub,
      id: ["prime", "encode", "feynman", "retrieve", "gaps", "quiz", "connect", "spaced"][i],
      number: i + 1,
    }));
    return {
      steps,
      currentStep: steps[0],
      currentStepIdx: 0,
      totalSteps: 8,
      completedSteps: 0,
    };
  }
}

/** Lecture rows keyed by id from rxt-lec-meta (for orphan filtering). */
function loadLecMetaById() {
  try {
    const allLecs = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
    if (!Array.isArray(allLecs)) return {};
    return Object.fromEntries(allLecs.map((l) => [l?.id, l]).filter(([id]) => id));
  } catch {
    return {};
  }
}

/**
 * Tracker row / badge status from rxt-performance aggregate score (not objective rows).
 */
export function getLecStatus(lecId, blockId) {
  try {
    if (!lecId || !blockId) return "untested";
    const perf = JSON.parse(localStorage.getItem("rxt-performance") || "{}");
    const rec = perf[`${lecId}__${blockId}`];
    if (!rec?.score && rec?.score !== 0) return "untested";
    const sc = Number(rec.score);
    if (!Number.isFinite(sc)) return "untested";
    if (sc >= 80) return "good";
    if (sc >= 60) return "okay";
    return "struggling";
  } catch {
    return "untested";
  }
}

function mergeTrackerDisplayStatus(lecId, blockId, fallbackConf) {
  const ps = getLecStatus(lecId, blockId);
  if (ps !== "untested") return ps;
  return fallbackConf || null;
}

/** Title for tracker rows: prefer in-memory `lec`, else `rxt-lec-meta` (avoids stale row.topic when props omit this id). */
function getTrackerLectureTitle(lectureId, lecFromProps) {
  const fromProps = (lecFromProps?.lectureTitle || lecFromProps?.fileName || lecFromProps?.filename || "").trim();
  if (fromProps) return fromProps;
  if (!lectureId) return "";
  try {
    const all = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
    const l = Array.isArray(all) ? all.find((x) => x?.id === lectureId) : null;
    return (l?.lectureTitle || l?.title || l?.filename || l?.fileName || "").trim() || "";
  } catch {
    return "";
  }
}

function cleanOrphanPerfAndCompletion() {
  const allLecs = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
  if (!Array.isArray(allLecs) || allLecs.length === 0) return { changed: false, completionChanged: false };
  const validIds = new Set(allLecs.map((l) => l?.id).filter(Boolean));
  if (validIds.size === 0) return { changed: false, completionChanged: false };
  let changed = false;
  let completionChanged = false;
  ["rxt-performance", "rxt-completion"].forEach((storeKey) => {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(storeKey) || "{}");
    } catch {
      return;
    }
    if (!stored || typeof stored !== "object") return;
    let localChanged = false;
    Object.keys(stored).forEach((key) => {
      const lecId = key.split("__")[0];
      if (!validIds.has(lecId)) {
        delete stored[key];
        localChanged = true;
      }
    });
    if (localChanged) {
      changed = true;
      localStorage.setItem(storeKey, JSON.stringify(stored));
      if (storeKey === "rxt-completion") completionChanged = true;
    }
  });
  return { changed, completionChanged };
}

/** Study day starts at 3am local (after midnight still counts as previous calendar day until 3am). */
export function startOfStudyDay() {
  const now = new Date();
  const boundary = new Date(now);
  boundary.setHours(3, 0, 0, 0);
  if (now < boundary) {
    boundary.setDate(boundary.getDate() - 1);
  }
  boundary.setMilliseconds(0);
  return boundary;
}

export function endOfStudyDay() {
  const start = startOfStudyDay();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(3, 0, 0, 0);
  return end;
}

function studyDayKeyFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function studyDayKeyNow() {
  return studyDayKeyFromDate(startOfStudyDay());
}

/** Sort key Mon..Sun for lecture schedule (string or number). */
function rankDayOfWeek(dow) {
  if (dow == null || dow === "") return 99;
  if (typeof dow === "number" && !Number.isNaN(dow)) return dow;
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const s = String(dow).slice(0, 3).toLowerCase();
  const i = order.findIndex((x) => s.startsWith(x));
  return i >= 0 ? i : 99;
}

function lecObjsForLecture(objs, lec) {
  return (objs || []).filter(
    (o) =>
      String(o.lectureNumber) === String(lec.lectureNumber) ||
      o.linkedLecId === lec.id
  );
}

function isCriticalLectureFromData(lec, blockId, perfEntry, completionEntry, getBlockObjectives) {
  const objs = typeof getBlockObjectives === "function" ? getBlockObjectives(blockId) : [];
  const lecObjs = lecObjsForLecture(objs, lec);
  const hasStruggling = lecObjs.some((o) => o.status === "struggling");
  const lowScore = perfEntry?.score != null && Number(perfEntry.score) < 70;
  const neverStudied = !perfEntry && lecObjs.length > 0;
  const lowConsec = lecObjs.some(
    (o) => (o.consecutiveCorrect || 0) === 0 && (o.drillCount || 0) > 1
  );
  return hasStruggling || lowScore || neverStudied || lowConsec;
}

function isSoonLectureFromData(lec, blockId, perfEntry, completionEntry, _getBlockObjectives) {
  const nr = perfEntry?.nextReview ? new Date(perfEntry.nextReview) : null;
  const st = startOfStudyDay();
  const threeDaysEnd = new Date(st);
  threeDaysEnd.setDate(threeDaysEnd.getDate() + 3);
  threeDaysEnd.setHours(23, 59, 59, 999);
  const inWindow =
    nr &&
    !isNaN(nr.getTime()) &&
    nr >= st &&
    nr <= threeDaysEnd;

  const rawSessions = perfEntry?.sessions || [];
  const lecSessions = rawSessions.filter((s) => !s.lectureId || s.lectureId === lec.id);
  const studiedOnceNotReviewed =
    lecSessions.length === 1 &&
    (!completionEntry?.reviewDates || completionEntry.reviewDates.length === 0);

  return !!(inWindow || studiedOnceNotReviewed);
}

function isOkLectureFromData(lec, blockId, perfEntry, completionEntry, getBlockObjectives) {
  const objs = typeof getBlockObjectives === "function" ? getBlockObjectives(blockId) : [];
  const lecObjs = lecObjsForLecture(objs, lec);
  const score = perfEntry?.score;
  if (score == null || Number(score) < 80) return false;
  if (lecObjs.length === 0) return true;
  const okCount = lecObjs.filter((o) => (o.consecutiveCorrect || 0) >= 3).length;
  return okCount > lecObjs.length / 2;
}

// ── Constants ─────────────────────────────────────────────
const MONO  = "'DM Mono','Courier New',monospace";
const SERIF = "'Playfair Display',Georgia,serif";

const BLOCKS = ["FTM 1","FTM 2","MSK","CPR 1","CPR 2"];

// Confidence scale — drives how often a subject should be reviewed
const CONFIDENCE = [
  { value:1, label:"No Clue",    color:"#ef4444", bg:"#150404", border:"#450a0a", reviewDays:1  },
  { value:2, label:"Struggling", color:"#f97316", bg:"#160800", border:"#431407", reviewDays:2  },
  { value:3, label:"Shaky",      color:"#f59e0b", bg:"#160e00", border:"#451a03", reviewDays:3  },
  { value:4, label:"Getting It", color:"#84cc16", bg:"#0c1400", border:"#1a2e05", reviewDays:5  },
  { value:5, label:"Solid",      color:"#10b981", bg:"#021710", border:"#064e3b", reviewDays:7  },
  { value:6, label:"Mastered",   color:"#06b6d4", bg:"#021419", border:"#0e4f5e", reviewDays:14 },
];

// ── Helpers ───────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;

/** Score chip colors for question sessions (pct 0–100) */
function questionSessionScoreChipStyle(pct) {
  if (pct >= 70) return { bg: "#EAF3DE", color: "#27500A" };
  if (pct >= 50) return { bg: "#FAEEDA", color: "#633806" };
  return { bg: "#FCEBEB", color: "#A32D2D" };
}

/** Sync weak lecture to rxt-completion for Today's review queue (used from App drill / quiz). */
export function addLectureToTodayReview(lec, blockId) {
  if (!lec || !blockId) return false;
  try {
    const completionKey = "rxt-completion";
    const stored = JSON.parse(localStorage.getItem(completionKey) || "{}");
    const key = `${lec.id}__${blockId}`;
    const existing = stored[key] || {
      lectureId: lec.id,
      blockId,
      ankiInRotation: false,
      firstCompletedDate: null,
      lastActivityDate: null,
      lastConfidence: "struggling",
      reviewDates: [],
      activityLog: [],
    };
    const todayKey = studyDayKeyNow();
    const todayISO = new Date(startOfStudyDay()).toISOString();

    const alreadyToday = (existing.reviewDates || []).some((d) => {
      const ds = String(d || "").slice(0, 10);
      return ds === todayKey;
    });

    if (!alreadyToday) {
      existing.reviewDates = [todayKey, ...(existing.reviewDates || [])];
    }
    existing.lastConfidence = "struggling";
    if (!existing.firstCompletedDate) {
      existing.firstCompletedDate = todayISO;
    }
    stored[key] = {
      ...existing,
      lectureId: lec.id,
      blockId,
    };
    localStorage.setItem(completionKey, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent("rxt-completion-updated"));
    return true;
  } catch (e) {
    console.error("addLectureToTodayReview failed:", e);
    return false;
  }
}

/** Post-drill session summary (reads objective statuses from storage after assess). */
export function buildDrillSummary(drillQueue, drillStats, blockId) {
  let blockObjs = [];
  try {
    const stored = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
    const raw = stored[blockId];
    if (Array.isArray(raw)) {
      blockObjs = raw;
    } else if (raw && typeof raw === "object") {
      blockObjs = [
        ...(Array.isArray(raw.imported) ? raw.imported : []),
        ...(Array.isArray(raw.extracted) ? raw.extracted : []),
      ];
    }
  } catch {
    blockObjs = [];
  }

  let lecs = [];
  try {
    lecs = JSON.parse(localStorage.getItem("rxt-lecs") || "[]").filter((l) => l && l.blockId === blockId);
  } catch {
    lecs = [];
  }

  const assessedIds = new Set(
    (drillStats?.assessedIndices || []).map((idx) => drillQueue[idx]?.id).filter(Boolean)
  );

  const assessedObjs = (drillQueue || []).filter((o) => assessedIds.has(o.id));

  const masteredObjs = [];
  const okayObjs = [];
  const strugglingObjs = [];

  assessedObjs.forEach((obj) => {
    const current = blockObjs.find((o) => o.id === obj.id);
    const status = current?.status || "untested";
    if (status === "mastered") masteredObjs.push(obj);
    else if (status === "inprogress") okayObjs.push(obj);
    else if (status === "struggling") strugglingObjs.push(obj);
  });

  const weakByLecture = {};
  strugglingObjs.forEach((obj) => {
    const lec = lecs.find((l) => l.id === obj.linkedLecId);
    const lecId = lec?.id || "unknown";
    const lecLabel = lec
      ? `${lec.lectureType || "LEC"} ${lec.lectureNumber ?? ""} — ${lec.lectureTitle || lec.title || lec.filename || ""}`
      : "Unknown lecture";

    if (!weakByLecture[lecId]) {
      weakByLecture[lecId] = {
        lec,
        lecLabel,
        lecId,
        objectives: [],
      };
    }
    weakByLecture[lecId].objectives.push(obj);
  });

  const weakLectures = Object.values(weakByLecture).sort(
    (a, b) => b.objectives.length - a.objectives.length
  );

  const total = assessedObjs.length;
  const score = total > 0 ? Math.round((masteredObjs.length / total) * 100) : 0;

  return {
    total,
    mastered: masteredObjs.length,
    okay: okayObjs.length,
    struggling: strugglingObjs.length,
    skipped: drillStats?.skipped || 0,
    score,
    weakLectures,
    strugglingObjs,
    sessionDate: new Date().toISOString(),
  };
}

/** Today's questions activity with questionScore for Done pill (Today tab) */
function getTodayQuestionScoreForDonePill(entry, todayStr) {
  if (!entry?.activityLog || !todayStr) return null;
  const act = entry.activityLog.find(
    (a) =>
      String(a?.date || "").slice(0, 10) === todayStr &&
      a.activityType === "questions" &&
      a.questionScore != null
  );
  if (!act || act.questionCount == null) return null;
  return {
    correct: act.correctCount ?? 0,
    total: act.questionCount,
    score: act.questionScore,
  };
}

/** Done pill: prefer App drill sync `lastDrillResult` (MCQ counts), else today's questions activity log */
function getDonePillModel(entry, todayStr, themeT) {
  const last = entry?.lastDrillResult;
  let correct = 0;
  let total = 0;
  let pct = 0;
  let hasResult = false;

  if (last && (last.questionsAnswered ?? 0) > 0) {
    const drillDay = String(last.date || "").slice(0, 10);
    if (drillDay === todayStr) {
      total = last.questionsAnswered ?? 0;
      correct = last.questionsCorrect ?? 0;
      pct =
        last.score != null
          ? last.score
          : total > 0
            ? Math.round((correct / total) * 100)
            : 0;
      hasResult = total > 0;
    }
  }
  if (!hasResult) {
    const q = getTodayQuestionScoreForDonePill(entry, todayStr);
    if (q) {
      correct = q.correct;
      total = q.total;
      pct = q.score;
      hasResult = true;
    }
  }

  const badgeColor = !hasResult
    ? themeT.text3
    : pct >= 80
      ? themeT.statusGood
      : pct >= 60
        ? themeT.statusWarn
        : themeT.statusBad;

  const bg = !hasResult
    ? themeT.inputBg
    : pct >= 80
      ? themeT.statusGoodBg
      : pct >= 60
        ? themeT.statusWarnBg
        : themeT.statusBadBg;

  const borderCol = !hasResult ? themeT.statusGoodBorder : badgeColor;

  const label = hasResult ? `✓ Done · ${correct}/${total} (${pct}%)` : `✓ Done · no drill yet`;

  return { label, badgeColor, bg, borderCol, hasResult };
}

// ── Completion + spaced repetition (rxt-completion) ────────
// Saturday = day 6
export function getNextSaturday(fromDate) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const delta = (6 - day + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export function getPressureZone(examDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = new Date(examDate);
  exam.setHours(0, 0, 0, 0);
  const days = Math.ceil((exam - today) / (1000 * 60 * 60 * 24));

  if (days <= 0) return { zone: "exam", days, label: "Exam day" };
  if (days <= 3) return { zone: "critical", days, label: "Final push" };
  if (days <= 7) return { zone: "crunch", days, label: "Exam week" };
  if (days <= 14) return { zone: "build", days, label: "Building" };
  return { zone: "normal", days, label: "On schedule" };
}

export function computeReviewDates(completedDate, confidenceRating, examDate) {
  const base = new Date(completedDate);
  base.setHours(0, 0, 0, 0);
  const exam = examDate ? new Date(examDate) : null;
  if (exam) exam.setHours(0, 0, 0, 0);

  const addDays = (d, days) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const pressure = examDate ? getPressureZone(examDate) : { zone: "normal", days: 999, label: "On schedule" };
  const zone = pressure.zone;
  const daysLeft = pressure.days;

  // Base intervals by confidence (days)
  let intervals =
    ({
      good: [2, 7, 14, 30],
      okay: [1, 5, 10, 21],
      struggling: [0, 2, 5, 10],
    }[confidenceRating] || [1, 7, 14, 30]).slice();

  const compressionFactor =
    ({
      normal: 1.0,
      build: 0.75,
      crunch: 0.5,
      critical: 0.25,
      exam: 0,
    }[zone] ?? 1.0);

  intervals = intervals.map((d) => Math.round(d * compressionFactor));

  // Cap any interval at daysUntilExam - 1 in crunch/critical/exam to avoid > exam
  if (zone === "crunch" || zone === "critical" || zone === "exam") {
    intervals = intervals.map((d) => Math.min(d, Math.max(daysLeft - 1, 0)));
  }

  const dates = [];

  // Always add next Saturday sweep if before exam
  if (exam) {
    const nextSat = getNextSaturday(base);
    if (nextSat < exam) dates.push(nextSat);
  }

  // Interval-based dates
  intervals.forEach((d) => {
    if (d === 0) return; // skip same-day in normal scheduling; activity itself is the "same day"
    const r = addDays(base, d);
    if (!exam || r < exam) dates.push(r);
  });

  // In crunch/critical: add every remaining day until exam
  if (exam && (zone === "critical" || zone === "crunch")) {
    for (let d = 1; d < Math.max(daysLeft, 0); d++) {
      const r = addDays(new Date(), d);
      if (r < exam) dates.push(r);
    }
  }

  // Deduplicate + sort ascending; drop past dates
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const uniq = new Map(dates.map((d) => [d.toDateString(), d]));
  return Array.from(uniq.values())
    .filter((d) => d >= today)
    .sort((a, b) => a.getTime() - b.getTime());
}

// Pure helper (read-only): summarize lecture activity from localStorage rxt-completion
function getLectureActivitySummary(lectureId, blockId) {
  try {
    const completions = JSON.parse(localStorage.getItem("rxt-completion") || "{}");
    const entry = completions[`${lectureId}__${blockId}`];
    if (!entry || !Array.isArray(entry.activityLog) || entry.activityLog.length === 0) {
      return { count: 0, recentIcons: [], status: "untouched", confidence: null };
    }
    const iconMap = {
      deep_learn: "🧠",
      review: "📖",
      anki: "🃏",
      questions: "❓",
      notes: "📝",
      sg_tbl: "👥",
      manual: "✏️",
    };
    const log = entry.activityLog; // newest-first
    const recentIcons = log.slice(0, 6).map((a) => iconMap[a?.activityType] || "✏️");
    const count = log.length;
    const conf = entry.lastConfidence || null;
    let status = "building";
    if (count === 0) status = "untouched";
    else if (conf === "struggling") status = "needs-work";
    else if (conf === "okay" && count >= 3) status = "on-track";
    else if (conf === "good" && count >= 2) status = "strong";
    return { count, recentIcons, status, confidence: conf };
  } catch {
    return { count: 0, recentIcons: [], status: "untouched", confidence: null };
  }
}

// Pure: confidence trend from activityLog (read-only). T = theme for colors (optional).
export function getConfidenceTrend(activityLog, T) {
  if (!activityLog || activityLog.length < 2) return { trend: "new", arrow: null, color: null };
  const scoreMap = { good: 3, okay: 2, struggling: 1 };
  const recent = activityLog
    .slice(0, 5)
    .filter((a) => a.confidenceRating)
    .map((a) => scoreMap[a.confidenceRating] || 0);
  if (recent.length < 2) return { trend: "new", arrow: null, color: null };
  const mid = Math.ceil(recent.length / 2);
  const recentAvg = recent.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const olderAvg = recent.slice(mid).reduce((s, v) => s + v, 0) / (recent.length - mid);
  const delta = recentAvg - olderAvg;
  const statusGood = T?.statusGood ?? null;
  const statusBad = T?.statusBad ?? null;
  const statusWarn = T?.statusWarn ?? null;
  if (delta > 0.4) return { trend: "improving", arrow: "↑", color: statusGood };
  if (delta < -0.4) return { trend: "declining", arrow: "↓", color: statusBad };
  if (recentAvg >= 2.5) return { trend: "strong", arrow: "→", color: statusGood };
  if (recentAvg <= 1.4) return { trend: "stuck", arrow: "→", color: statusBad };
  return { trend: "flat", arrow: "→", color: statusWarn };
}

function computeWeakClusters(blockId, completions, lectures) {
  const byWeek = {};
  (lectures || []).forEach((lec) => {
    const week = lec.weekNumber ?? "unscheduled";
    if (!byWeek[week]) byWeek[week] = [];
    byWeek[week].push(lec);
  });
  const clusters = [];
  Object.entries(byWeek).forEach(([week, lecs]) => {
    const byType = {};
    lecs.forEach((lec) => {
      const type = lec.lectureType || "other";
      if (!byType[type]) byType[type] = [];
      byType[type].push(lec);
    });
    Object.entries(byType).forEach(([type, typeLecs]) => {
      if (typeLecs.length === 0) return;
      const scores = typeLecs.map((lec) => {
        const entry = (completions || {})[`${lec.id}__${blockId}`];
        if (!entry || !entry.activityLog || entry.activityLog.length === 0) {
          return { lec, score: 0, confidence: null, interactions: 0 };
        }
        const confMap = { good: 3, okay: 2, struggling: 1 };
        const conf = confMap[entry.lastConfidence] || 0;
        return {
          lec,
          score: conf,
          confidence: entry.lastConfidence,
          interactions: entry.activityLog.length,
        };
      });
      const avgScore = scores.reduce((s, v) => s + v.score, 0) / scores.length;
      const strugglingCount = scores.filter((s) => s.confidence === "struggling").length;
      const untouchedCount = scores.filter((s) => s.interactions === 0).length;
      clusters.push({
        week,
        type,
        lectures: typeLecs,
        avgScore,
        strugglingCount,
        untouchedCount,
        totalCount: typeLecs.length,
        level:
          avgScore < 1.5 || strugglingCount / typeLecs.length > 0.5
            ? "critical"
            : avgScore < 2.2
              ? "weak"
              : untouchedCount > 0
                ? "gaps"
                : "strong",
      });
    });
  });
  const order = { critical: 0, weak: 1, gaps: 2, strong: 3 };
  return clusters.sort((a, b) => order[a.level] - order[b.level]);
}

function getOverdueLectures(blockId, completions) {
  const todayStart = startOfStudyDay();
  const todayStr = studyDayKeyNow();

  return Object.values(completions || {})
    .filter((entry) => entry && entry.blockId === blockId)
    .filter((entry) => {
      const rds = Array.isArray(entry.reviewDates) ? entry.reviewDates : [];
      if (rds.length === 0) return false;

      const overdueDates = rds
        .map((d) => {
          const rd = new Date(d);
          rd.setHours(0, 0, 0, 0);
          return rd;
        })
        .filter((d) => d < todayStart)
        .sort((a, b) => a - b);
      if (overdueDates.length === 0) return false;

      const earliestOverdue = overdueDates[0];
      const lastActivity = entry.lastActivityDate ? new Date(entry.lastActivityDate) : null;
      if (!lastActivity) return true;
      lastActivity.setHours(0, 0, 0, 0);
      return lastActivity < earliestOverdue;
    })
    .map((entry) => {
      const rds = Array.isArray(entry.reviewDates) ? entry.reviewDates : [];
      const overdue = rds
        .map((d) => ({ raw: d, dt: new Date(d) }))
        .map((x) => {
          x.dt.setHours(0, 0, 0, 0);
          return x;
        })
        .filter((x) => x.dt < todayStart)
        .sort((a, b) => a.dt - b.dt);
      const earliest = overdue[0]?.raw || todayStr;
      const daysOverdue = Math.ceil((todayStart - new Date(earliest)) / (1000 * 60 * 60 * 24));
      return {
        ...entry,
        overdueSince: earliest,
        daysOverdue,
      };
    })
    .sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
}

function getSweepBannerState(blockId, completions, lectures) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const hour = now.getHours();
  const showWindow =
    (dayOfWeek === 5 && hour >= 16) ||
    (dayOfWeek === 6) ||
    (dayOfWeek === 0 && hour < 12);
  if (!showWindow) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const oneWeekAgo = new Date(today);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const sweepLectures = Object.values(completions || {})
    .filter((e) => e.blockId === blockId)
    .filter((e) => {
      if (!e.lastActivityDate) return false;
      const last = new Date(e.lastActivityDate);
      last.setHours(0, 0, 0, 0);
      if (last < oneWeekAgo) return false;
      if (dayOfWeek === 0) return last < yesterday;
      return last < today;
    });

  const blockLecs = (lectures || []).filter((l) => l.blockId === blockId);
  const untouchedCount = blockLecs.filter((l) => {
    const e = (completions || {})[`${l.id}__${blockId}`];
    return !e || !e.lastActivityDate;
  }).length;

  return {
    sweepCount: sweepLectures.length,
    untouchedCount,
    dayOfWeek,
    label:
      dayOfWeek === 5
        ? "Tomorrow is your weekly sweep day"
        : dayOfWeek === 6
          ? "Today is your weekly sweep day"
          : "Catch up on this week before it closes",
  };
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function getConf(val) { return CONFIDENCE.find(c => c.value === val) || CONFIDENCE[0]; }

function getUrgency(confidence, lastStudied) {
  if (!confidence) return "none";
  const days = daysSince(lastStudied);
  const threshold = getConf(confidence).reviewDays;
  if (days === null) return confidence <= 2 ? "critical" : "none";
  const ratio = days / threshold;
  if (ratio >= 2)   return "critical";
  if (ratio >= 1.2) return "overdue";
  if (ratio >= 0.8) return "soon";
  return "ok";
}

const URG = {
  critical: { color:"#ef4444", bg:"#150404", border:"#450a0a", label:"REVIEW NOW",  glow:"0 0 14px #ef444430" },
  overdue:  { color:"#f97316", bg:"#130800", border:"#431407", label:"OVERDUE",      glow:"0 0 8px #f9731620"  },
  soon:     { color:"#f59e0b", bg:"#160e00", border:"#451a03", label:"SOON",         glow:"none"               },
  ok:       { color:"#10b981", bg:"transparent", border:"transparent", label:"OK",   glow:"none"               },
  none:     { color:"#374151", bg:"transparent", border:"transparent", label:"",     glow:"none"               },
};

function makeRow(o = {}) {
  return {
    block:"FTM 2", subject:"", topic:"",
    lectureDate:"", lastStudied:"", ankiDate:"",
    preRead:false, lecture:false, postReview:false, anki:false,
    confidence:null, scores:[], notes:"", ...o,
    id: o.id || uid(),
  };
}

const SAMPLE = [
  makeRow({ id:"s1", block:"FTM 2", subject:"Physiology",   topic:"Cardiac Cycle",          lectureDate:"2025-02-03", lastStudied:"2025-02-10", lecture:true, preRead:true,  confidence:3 }),
  makeRow({ id:"s2", block:"FTM 2", subject:"Physiology",   topic:"Renal Filtration",        lectureDate:"2025-02-05", lastStudied:"2025-02-08", lecture:true,               confidence:2 }),
  makeRow({ id:"s3", block:"FTM 2", subject:"Pharmacology", topic:"Autonomic Pharmacology",  lectureDate:"2025-02-07", lastStudied:"2025-02-12", lecture:true, postReview:true, confidence:4 }),
  makeRow({ id:"s4", block:"MSK",   subject:"Anatomy",      topic:"Upper Limb",              lectureDate:"2025-02-10", lastStudied:"2025-02-20", lecture:true, preRead:true, postReview:true, confidence:5 }),
];

// ─────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────

// Shared date input style (calendar picker, theme-aware)
function dateInputStyle(T, isDark) {
  return {
    background: T.inputBg,
    border: "1px solid " + T.border1,
    color: T.text1,
    padding: "4px 8px",
    borderRadius: 6,
    fontFamily: MONO,
    fontSize: 13,
    outline: "none",
    cursor: "pointer",
    width: "100%",
    colorScheme: isDark ? "dark" : "light",
  };
}

// Confidence dropdown picker
function ConfPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const { T, isDark } = useTheme();
  const conf = value ? getConf(value) : null;
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const triggerBg = conf ? (isDark ? conf.bg : conf.color+"26") : "transparent";
  const triggerBorder = conf ? (isDark ? conf.color+"40" : conf.color) : T.border1;
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <div onClick={() => setOpen(p=>!p)} style={{
        display:"flex", alignItems:"center", gap:5, cursor:"pointer", padding:"3px 8px",
        borderRadius:6, border:"1px solid "+triggerBorder,
        background:triggerBg, transition:"all 0.15s", whiteSpace:"nowrap", userSelect:"none",
      }}>
        {conf
          ? <><div style={{ width:10, height:10, borderRadius:"50%", background:conf.color, flexShrink:0 }}/><span style={{ fontFamily:MONO, color:conf.color, fontSize:13, fontWeight:600 }}>{conf.label}</span></>
          : <span style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>Rate confidence</span>}
        <span style={{ color:T.text4, fontSize:13, marginLeft:2 }}>▾</span>
      </div>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:600, background:T.pickerBg||T.cardBg,
          border:"1px solid "+(T.pickerBorder||T.border1), borderRadius:10, padding:6, minWidth:185, boxShadow:"0 12px 40px #000c" }}>
          {CONFIDENCE.map(c => (
            <div key={c.value} onClick={()=>{ onChange(c.value); setOpen(false); }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:7, cursor:"pointer",
                background:value===c.value?(isDark?c.bg:c.color+"26"):"transparent", border:"1px solid "+(value===c.value?c.color+(isDark?"40":""):"transparent"), marginBottom:2, transition:"all 0.1s" }}
              onMouseEnter={e=>{ if(value!==c.value) e.currentTarget.style.background=T.pickerHover||T.rowHover; }}
              onMouseLeave={e=>{ if(value!==c.value) e.currentTarget.style.background="transparent"; }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:c.color, flexShrink:0 }}/>
              <span style={{ fontFamily:MONO, color:c.color, fontSize:13, fontWeight:600, flex:1 }}>{c.label}</span>
              <span style={{ fontFamily:MONO, color:T.text4, fontSize:13 }}>/{c.reviewDays}d</span>
            </div>
          ))}
          {value && <div onClick={()=>{ onChange(null); setOpen(false); }}
            style={{ padding:"5px 10px", cursor:"pointer", fontFamily:MONO, color:T.text4, fontSize:13, textAlign:"center", marginTop:2 }}>clear</div>}
        </div>
      )}
    </div>
  );
}

// Add Row Modal
function AddModal({ onAdd, onClose }) {
  const { T, isDark } = useTheme();
  const [row, setRow] = useState({ block:"FTM 2", subject:"", topic:"", lectureDate:"", lastStudied:"", ankiDate:"", confidence:null });
  const set = (k,v) => setRow(p=>({...p,[k]:v}));
  const INP = { background:T.inputBg, border:"1px solid "+T.border1, color:T.text1, padding:"8px 11px", borderRadius:7, fontFamily:MONO, fontSize:14, outline:"none", width:"100%" };
  const canSubmit = row.subject.trim().length > 0 && row.topic.trim().length > 0;
  const submit = () => {
    if (!canSubmit) return;
    onAdd(makeRow({ ...row, subject:row.subject.trim(), topic:row.topic.trim() }));
    onClose();
  };
  const optionalHint = { fontFamily: MONO, color: T.text4, fontSize: 13, marginTop: 3 };
  return (
    <div style={{ position:"fixed", inset:0, background:T.overlayBg, display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <div style={{ background:T.cardBg, border:"1px solid "+T.border1, borderRadius:18, padding:30, width:500, display:"flex", flexDirection:"column", gap:18, boxShadow:T.cardShadow }}>
        <div style={{ fontFamily:SERIF, fontSize:22, fontWeight:700, color:T.text1 }}>Add Lecture / Topic</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div style={{ gridColumn:"1/-1" }}>
            <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:5 }}>BLOCK</div>
            <select value={row.block} onChange={e=>set("block",e.target.value)} style={{...INP,cursor:"pointer"}}>
              {BLOCKS.map(b=><option key={b}>{b}</option>)}
            </select>
          </div>
          {[["subject","SUBJECT / COURSE","e.g. Physiology"],["topic","LECTURE / TOPIC","e.g. Cardiac Cycle"]].map(([k,l,ph])=>(
            <div key={k}>
              <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:5 }}>{l}</div>
              <input style={INP} placeholder={ph} value={row[k]} onChange={e=>set(k,e.target.value)} autoFocus={k==="subject"} onKeyDown={e=>k==="topic"&&e.key==="Enter"&&canSubmit&&submit()} />
            </div>
          ))}
          {[["lectureDate","LECTURE DATE"],["lastStudied","LAST STUDIED"],["ankiDate","ANKI CARD RELEASE"]].map(([k,l])=>(
            <div key={k}>
              <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:5 }}>{l}</div>
              <input type="date" value={row[k]} onChange={e=>set(k,e.target.value)} style={dateInputStyle(T, isDark)} title="Click to open calendar" />
              <div style={optionalHint}>optional</div>
            </div>
          ))}
          <div>
            <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:5 }}>CONFIDENCE LEVEL</div>
            <ConfPicker value={row.confidence} onChange={v=>set("confidence",v)} />
            <div style={optionalHint}>optional</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ background:T.border1, border:"none", color:T.text5, padding:"9px 20px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:14 }}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit} style={{ background:canSubmit?T.red:T.border1, border:"none", color:canSubmit?T.text1:T.text5, padding:"9px 24px", borderRadius:8, cursor:canSubmit?"pointer":"not-allowed", fontFamily:MONO, fontSize:15, fontWeight:700, opacity:canSubmit?1:0.7 }}>Add Row</button>
        </div>
      </div>
    </div>
  );
}

function newWrongQuestionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `wq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getBlockNameForWeakConcept(blockId) {
  try {
    const blocks = JSON.parse(localStorage.getItem("rxt-blocks") || "[]");
    const arr = Array.isArray(blocks) ? blocks : [];
    return arr.find((b) => b.id === blockId)?.name || blockId;
  } catch {
    return blockId;
  }
}

function lectureLabelFromLec(lec) {
  if (!lec) return "";
  return `${lec.lectureType || "LEC"} ${lec.lectureNumber ?? ""} — ${lec.lectureTitle || lec.title || lec.filename || ""}`.trim();
}

/** Compact wrong-questions-only panel for done cards (no logActivity). */
function QuickLogWrongOnlyPanel({ lec, blockId, onCancel, onWrongConceptsLogged, onDone }) {
  const { T: t } = useTheme();
  const [wrongQuestions, setWrongQuestions] = useState(() => [
    { id: newWrongQuestionId(), question: "", wrongAnswer: "", correctAnswer: "" },
  ]);
  const [saving, setSaving] = useState(false);

  function addWrongQuestionSlot() {
    setWrongQuestions((prev) => [
      ...prev,
      { id: newWrongQuestionId(), question: "", wrongAnswer: "", correctAnswer: "" },
    ]);
  }

  function updateWrongQuestion(id, field, value) {
    setWrongQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, [field]: value } : q)));
  }

  function removeWrongQuestion(id) {
    setWrongQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  async function handleAdd() {
    const filled = wrongQuestions.filter((wq) => wq.question.trim().length > 5);
    if (filled.length === 0 || !lec?.id) return;
    setSaving(true);
    try {
      const lecLabel = lectureLabelFromLec(lec);
      const blockName = getBlockNameForWeakConcept(blockId);
      filled.forEach((wq) => {
        recordWrongAnswer({
          blockId,
          blockName,
          question: wq.question.trim(),
          wrongAnswer: wq.wrongAnswer.trim() || "Not specified",
          correctAnswer: wq.correctAnswer.trim() || "Not specified",
          linkedLecId: lec.id,
          lectureLabel: lecLabel,
          source: "manual",
        }).catch((e) => console.error("recordWrongAnswer failed:", e));
      });
      onWrongConceptsLogged?.(filled.length);
      onDone?.();
    } finally {
      setSaving(false);
    }
  }

  const filledCount = wrongQuestions.filter((wq) => wq.question.trim().length > 5).length;

  return (
    <div
      data-quicklog-wrong-only
      onClick={(e) => e.stopPropagation()}
      style={{
        background: t.inputBg,
        border: "0.5px solid " + t.border2,
        borderTop: "none",
        borderRadius: "0 0 10px 10px",
        padding: "12px 14px",
        marginBottom: 6,
        marginTop: -6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        Questions you got wrong
      </div>

      {wrongQuestions.map((wq, idx) => (
        <div
          key={wq.id}
          style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 8,
            position: "relative",
          }}
        >
          <button
            type="button"
            onClick={() => removeWrongQuestion(wq.id)}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 20,
              height: 20,
              border: "none",
              background: "transparent",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
            }}
          >
            ✕
          </button>

          <div
            style={{
              fontSize: 10,
              color: "var(--color-text-tertiary)",
              marginBottom: 6,
            }}
          >
            Question {idx + 1}
          </div>

          <textarea
            value={wq.question}
            onChange={(e) => updateWrongQuestion(wq.id, "question", e.target.value)}
            placeholder="Write the question (or topic/concept you got wrong)..."
            rows={2}
            style={{
              width: "100%",
              fontSize: 12,
              lineHeight: 1.5,
              padding: "6px 8px",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: 6,
              background: "var(--color-background-primary)",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-sans)",
              resize: "vertical",
              marginBottom: 6,
            }}
          />

          <textarea
            value={wq.wrongAnswer}
            onChange={(e) => updateWrongQuestion(wq.id, "wrongAnswer", e.target.value)}
            placeholder="What you answered / what you thought..."
            rows={1}
            style={{
              width: "100%",
              fontSize: 12,
              lineHeight: 1.5,
              padding: "6px 8px",
              border: "0.5px solid #F09595",
              borderRadius: 6,
              background: "#FCEBEB",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-sans)",
              resize: "vertical",
              marginBottom: 6,
            }}
          />

          <textarea
            value={wq.correctAnswer}
            onChange={(e) => updateWrongQuestion(wq.id, "correctAnswer", e.target.value)}
            placeholder="The correct answer / what it actually is..."
            rows={1}
            style={{
              width: "100%",
              fontSize: 12,
              lineHeight: 1.5,
              padding: "6px 8px",
              border: "0.5px solid #97C459",
              borderRadius: 6,
              background: "#EAF3DE",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-sans)",
              resize: "vertical",
            }}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addWrongQuestionSlot}
        style={{
          fontSize: 11,
          padding: "4px 12px",
          border: "0.5px dashed var(--color-border-secondary)",
          borderRadius: 6,
          background: "transparent",
          color: "var(--color-text-tertiary)",
          cursor: "pointer",
          width: "100%",
          textAlign: "center",
          marginBottom: 8,
        }}
      >
        + Add another wrong question
      </button>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            fontSize: 12,
            fontFamily: MONO,
            padding: "5px 12px",
            border: "0.5px solid " + t.border2,
            borderRadius: 6,
            background: "transparent",
            color: t.text2,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={filledCount === 0 || saving}
          style={{
            fontSize: 12,
            fontFamily: MONO,
            padding: "5px 12px",
            border: "none",
            borderRadius: 6,
            background: filledCount > 0 && !saving ? "#2563eb" : t.border1,
            color: filledCount > 0 && !saving ? "#fff" : t.text3,
            cursor: filledCount > 0 && !saving ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Adding..." : "Add to Weak Concepts"}
        </button>
      </div>
    </div>
  );
}

/** Inline quick log for Today tab (Overdue / Today's lectures / Reviews due) */
function QuickLogFormContent({ lec, blockId, examDate, todayStr, logActivity, onSave, onCancel, onWrongConceptsLogged }) {
  const { T: t } = useTheme();
  const [activityType, setActivityType] = useState("review");
  const [confidenceRating, setConfidenceRating] = useState(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [questionCount, setQuestionCount] = useState("");
  const [correctCount, setCorrectCount] = useState("");
  const [showWrongQuestions, setShowWrongQuestions] = useState(false);
  const [wrongQuestions, setWrongQuestions] = useState([]);

  const activityTypes = [
    { key: "deep_learn", label: "Deep Learn", icon: "🧠" },
    { key: "review", label: "Review", icon: "📖" },
    { key: "anki", label: "Anki", icon: "🃏" },
    { key: "questions", label: "Questions", icon: "❓" },
    { key: "notes", label: "Notes", icon: "📝" },
    { key: "sg_tbl", label: "SG/TBL", icon: "👥" },
  ];

  useEffect(() => {
    if (activityType !== "questions") {
      setQuestionCount("");
      setCorrectCount("");
      setShowWrongQuestions(false);
      setWrongQuestions([]);
    }
  }, [activityType]);

  function addWrongQuestionSlot() {
    setWrongQuestions((prev) => [
      ...prev,
      { id: newWrongQuestionId(), question: "", wrongAnswer: "", correctAnswer: "" },
    ]);
  }

  function updateWrongQuestion(id, field, value) {
    setWrongQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, [field]: value } : q)));
  }

  function removeWrongQuestion(id) {
    setWrongQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  async function handleSave() {
    if (!lec?.id || !blockId || !confidenceRating) return;
    setSaving(true);
    try {
      const options = {
        note: note.trim() || null,
        date: todayStr,
        examDate: examDate || null,
      };

      if (activityType === "questions" && questionCount) {
        const total = parseInt(questionCount, 10) || 0;
        const correct = parseInt(correctCount, 10) || 0;
        const score = total > 0 ? Math.round((correct / total) * 100) : null;

        if (total > 0) {
          options.questionCount = total;
          options.correctCount = correct;
          options.questionScore = score;
          options.note = options.note || `${correct}/${total} correct (${score}%)`;
        }
      }

      await logActivity(lec.id, blockId, activityType, confidenceRating, options);

      const filledWrongQuestions = wrongQuestions.filter((wq) => wq.question.trim().length > 5);

      if (filledWrongQuestions.length > 0) {
        const lecLabel = lectureLabelFromLec(lec);
        const blockName = getBlockNameForWeakConcept(blockId);

        filledWrongQuestions.forEach((wq) => {
          recordWrongAnswer({
            blockId,
            blockName,
            question: wq.question.trim(),
            wrongAnswer: wq.wrongAnswer.trim() || "Not specified",
            correctAnswer: wq.correctAnswer.trim() || "Not specified",
            linkedLecId: lec.id,
            lectureLabel: lecLabel,
            source: "manual",
          }).catch((e) => console.error("recordWrongAnswer failed:", e));
        });

        onWrongConceptsLogged?.(filledWrongQuestions.length);
      }

      onSave?.();
    } catch (e) {
      console.error("Quick log save failed:", e);
    } finally {
      setSaving(false);
    }
  }

  const filledWrongCount = wrongQuestions.filter((wq) => wq.question.trim().length > 5).length;
  const accent = t.accent || t.statusProgress;

  return (
    <div
      data-quicklog-form
      onClick={(e) => e.stopPropagation()}
      style={{
        background: t.inputBg,
        border: "0.5px solid " + t.border2,
        borderTop: "none",
        borderRadius: "0 0 10px 10px",
        padding: "12px 14px",
        marginBottom: 6,
        marginTop: -6,
      }}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {activityTypes.map((at) => (
          <button
            key={at.key}
            type="button"
            onClick={() => setActivityType(at.key)}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 20,
              border: "1px solid " + (activityType === at.key ? accent : t.border1),
              cursor: "pointer",
              background: activityType === at.key ? accent : "transparent",
              color: activityType === at.key ? "#fff" : (t.textSecondary || t.text2),
              fontWeight: activityType === at.key ? 600 : 400,
            }}
          >
            {at.icon} {at.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => setConfidenceRating("good")}
          style={{
            flex: 1,
            padding: "8px 0",
            fontSize: 12,
            fontFamily: MONO,
            borderRadius: 6,
            cursor: "pointer",
            border: "0.5px solid",
            background: confidenceRating === "good" ? "#EAF3DE" : "transparent",
            color: confidenceRating === "good" ? "#27500A" : t.text2,
            borderColor: confidenceRating === "good" ? "#97C459" : t.border1,
          }}
        >
          ✓ Good
        </button>
        <button
          type="button"
          onClick={() => setConfidenceRating("okay")}
          style={{
            flex: 1,
            padding: "8px 0",
            fontSize: 12,
            fontFamily: MONO,
            borderRadius: 6,
            cursor: "pointer",
            border: "0.5px solid",
            background: confidenceRating === "okay" ? "#FAEEDA" : "transparent",
            color: confidenceRating === "okay" ? "#633806" : t.text2,
            borderColor: confidenceRating === "okay" ? "#EF9F27" : t.border1,
          }}
        >
          △ Okay
        </button>
        <button
          type="button"
          onClick={() => setConfidenceRating("struggling")}
          style={{
            flex: 1,
            padding: "8px 0",
            fontSize: 12,
            fontFamily: MONO,
            borderRadius: 6,
            cursor: "pointer",
            border: "0.5px solid",
            background: confidenceRating === "struggling" ? "#FCEBEB" : "transparent",
            color: confidenceRating === "struggling" ? "#A32D2D" : t.text2,
            borderColor: confidenceRating === "struggling" ? "#F09595" : t.border1,
          }}
        >
          ⚠ Struggling
        </button>
      </div>

      {activityType === "questions" && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "var(--color-background-secondary)",
            borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-tertiary)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "var(--color-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            Question session details
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div style={{ flex: 1 }}>
              <label
                style={{
                  fontSize: 11,
                  color: "var(--color-text-secondary)",
                  display: "block",
                  marginBottom: 3,
                }}
              >
                Questions done
              </label>
              <input
                type="number"
                min="1"
                max="999"
                value={questionCount}
                onChange={(e) => {
                  setQuestionCount(e.target.value);
                  if (correctCount && parseInt(e.target.value, 10) < parseInt(correctCount, 10)) {
                    setCorrectCount("");
                  }
                }}
                placeholder="e.g. 40"
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: "6px 8px",
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: 6,
                  background: "var(--color-background-primary)",
                  color: "var(--color-text-primary)",
                  textAlign: "center",
                }}
              />
            </div>

            <div
              style={{
                fontSize: 16,
                color: "var(--color-text-tertiary)",
                paddingTop: 18,
                flexShrink: 0,
              }}
            >
              /
            </div>

            <div style={{ flex: 1 }}>
              <label
                style={{
                  fontSize: 11,
                  color: "var(--color-text-secondary)",
                  display: "block",
                  marginBottom: 3,
                }}
              >
                Correct
              </label>
              <input
                type="number"
                min="0"
                max={questionCount || 999}
                value={correctCount}
                onChange={(e) => setCorrectCount(e.target.value)}
                placeholder="e.g. 32"
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: "6px 8px",
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: 6,
                  background: "var(--color-background-primary)",
                  color: "var(--color-text-primary)",
                  textAlign: "center",
                }}
              />
            </div>

            {questionCount && correctCount && (
              <div
                style={{
                  flexShrink: 0,
                  paddingTop: 18,
                  minWidth: 44,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    fontFamily: "var(--font-mono)",
                    color: (() => {
                      const pct = Math.round(
                        (parseInt(correctCount, 10) / parseInt(questionCount, 10)) * 100
                      );
                      return pct >= 70 ? "#639922" : pct >= 50 ? "#BA7517" : "#E24B4A";
                    })(),
                  }}
                >
                  {Math.round((parseInt(correctCount, 10) / parseInt(questionCount, 10)) * 100)}%
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 10 }}>
            {!showWrongQuestions ? (
              <button
                type="button"
                onClick={() => {
                  setShowWrongQuestions(true);
                  addWrongQuestionSlot();
                }}
                style={{
                  fontSize: 11,
                  padding: "4px 12px",
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: 6,
                  background: "transparent",
                  color: "var(--color-text-tertiary)",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                }}
              >
                + Log questions you got wrong (optional)
              </button>
            ) : (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--color-text-secondary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 8,
                  }}
                >
                  Questions you got wrong
                </div>

                {wrongQuestions.map((wq, idx) => (
                  <div
                    key={wq.id}
                    style={{
                      background: "var(--color-background-secondary)",
                      border: "0.5px solid var(--color-border-tertiary)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      marginBottom: 8,
                      position: "relative",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => removeWrongQuestion(wq.id)}
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 20,
                        height: 20,
                        border: "none",
                        background: "transparent",
                        color: "var(--color-text-tertiary)",
                        cursor: "pointer",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 4,
                      }}
                    >
                      ✕
                    </button>

                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--color-text-tertiary)",
                        marginBottom: 6,
                      }}
                    >
                      Question {idx + 1}
                    </div>

                    <textarea
                      value={wq.question}
                      onChange={(e) => updateWrongQuestion(wq.id, "question", e.target.value)}
                      placeholder="Write the question (or topic/concept you got wrong)..."
                      rows={2}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        lineHeight: 1.5,
                        padding: "6px 8px",
                        border: "0.5px solid var(--color-border-secondary)",
                        borderRadius: 6,
                        background: "var(--color-background-primary)",
                        color: "var(--color-text-primary)",
                        fontFamily: "var(--font-sans)",
                        resize: "vertical",
                        marginBottom: 6,
                      }}
                    />

                    <textarea
                      value={wq.wrongAnswer}
                      onChange={(e) => updateWrongQuestion(wq.id, "wrongAnswer", e.target.value)}
                      placeholder="What you answered / what you thought..."
                      rows={1}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        lineHeight: 1.5,
                        padding: "6px 8px",
                        border: "0.5px solid #F09595",
                        borderRadius: 6,
                        background: "#FCEBEB",
                        color: "var(--color-text-primary)",
                        fontFamily: "var(--font-sans)",
                        resize: "vertical",
                        marginBottom: 6,
                      }}
                    />

                    <textarea
                      value={wq.correctAnswer}
                      onChange={(e) => updateWrongQuestion(wq.id, "correctAnswer", e.target.value)}
                      placeholder="The correct answer / what it actually is..."
                      rows={1}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        lineHeight: 1.5,
                        padding: "6px 8px",
                        border: "0.5px solid #97C459",
                        borderRadius: 6,
                        background: "#EAF3DE",
                        color: "var(--color-text-primary)",
                        fontFamily: "var(--font-sans)",
                        resize: "vertical",
                      }}
                    />
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addWrongQuestionSlot}
                  style={{
                    fontSize: 11,
                    padding: "4px 12px",
                    border: "0.5px dashed var(--color-border-secondary)",
                    borderRadius: 6,
                    background: "transparent",
                    color: "var(--color-text-tertiary)",
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "center",
                    marginBottom: 6,
                  }}
                >
                  + Add another wrong question
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowWrongQuestions(false);
                    setWrongQuestions([]);
                  }}
                  style={{
                    fontSize: 11,
                    border: "none",
                    background: "transparent",
                    color: "var(--color-text-tertiary)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Hide this section
                </button>
              </div>
            )}
          </div>

          {questionCount &&
            correctCount &&
            (() => {
              const pct = Math.round(
                (parseInt(correctCount, 10) / parseInt(questionCount, 10)) * 100
              );
              const suggested = pct >= 70 ? "good" : pct >= 50 ? "okay" : "struggling";

              if (!confidenceRating) {
                return (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: "var(--color-text-tertiary)",
                      textAlign: "center",
                    }}
                  >
                    Suggested:{" "}
                    {suggested === "good" ? "✓ Good" : suggested === "okay" ? "△ Okay" : "⚠ Struggling"} based on{" "}
                    {pct}%
                    <button
                      type="button"
                      onClick={() => setConfidenceRating(suggested)}
                      style={{
                        marginLeft: 6,
                        fontSize: 11,
                        padding: "1px 8px",
                        border: "0.5px solid var(--color-border-secondary)",
                        borderRadius: 4,
                        background: "transparent",
                        color: "var(--color-text-secondary)",
                        cursor: "pointer",
                      }}
                    >
                      Apply
                    </button>
                  </div>
                );
              }
              return null;
            })()}
        </div>
      )}

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Quick note (optional)"
        style={{
          width: "100%",
          fontSize: 12,
          fontFamily: MONO,
          padding: "6px 8px",
          border: "0.5px solid " + t.border1,
          borderRadius: 6,
          background: t.cardBg,
          color: t.text1,
          marginBottom: 8,
          marginTop: 6,
          boxSizing: "border-box",
        }}
      />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            fontSize: 12,
            fontFamily: MONO,
            padding: "5px 12px",
            border: "0.5px solid " + t.border2,
            borderRadius: 6,
            background: "transparent",
            color: t.text2,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!confidenceRating || saving}
          style={{
            fontSize: 12,
            fontFamily: MONO,
            padding: "5px 12px",
            border: "none",
            borderRadius: 6,
            background: confidenceRating ? "#2563eb" : t.border1,
            color: confidenceRating ? "#fff" : t.text3,
            cursor: confidenceRating && !saving ? "pointer" : "not-allowed",
          }}
        >
          {saving
            ? "Saving..."
            : filledWrongCount > 0
              ? `Save + log ${filledWrongCount} wrong question${filledWrongCount > 1 ? "s" : ""}`
              : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ANALYTICS PANEL
// ─────────────────────────────────────────────────────────
function Analytics({ rows }) {
  const { T, isDark } = useTheme();
  const allScores = rows.flatMap(r=>r.scores);
  const overall   = avg(allScores);
  const acol      = p => p===null?T.text4:p>=80?T.green:p>=70?T.amber:p>=60?T.amber:T.red;

  const needsReview = rows
    .filter(r => ["critical","overdue"].includes(getUrgency(r.confidence,r.lastStudied)))
    .sort((a,b)=>{ const o={critical:0,overdue:1}; return o[getUrgency(a.confidence,a.lastStudied)]-o[getUrgency(b.confidence,b.lastStudied)]; });

  const byConf = {};
  CONFIDENCE.forEach(c=>{ byConf[c.value]={count:0,scores:[]}; });
  rows.forEach(r=>{ if(r.confidence&&byConf[r.confidence]){ byConf[r.confidence].count++; byConf[r.confidence].scores.push(...r.scores); } });

  const bySubject = {};
  rows.forEach(r=>{
    if(!bySubject[r.subject]) bySubject[r.subject]={scores:[],count:0,conf:[]};
    bySubject[r.subject].scores.push(...r.scores);
    bySubject[r.subject].count++;
    if(r.confidence) bySubject[r.subject].conf.push(r.confidence);
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:28 }}>
      {/* Summary cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {[
          { l:"Overall Score",   v:overall!==null?overall+"%":"—",       c:acol(overall) },
          { l:"Topics Tracked",  v:rows.length,                           c:T.blue     },
          { l:"Need Review Now", v:needsReview.length,                    c:needsReview.length>0?T.red:T.green },
          { l:"Fully Complete",  v:rows.filter(r=>r.preRead&&r.lecture&&r.postReview&&r.anki).length, c:T.green },
        ].map(({l,v,c})=>(
          <div key={l} style={{ background:T.cardBg, border:"1px solid "+T.border1, borderRadius:12, padding:"16px 18px", boxShadow:T.shadowSm }}>
            <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:6 }}>{l.toUpperCase()}</div>
            <div style={{ fontFamily:SERIF, color:c, fontSize:30, fontWeight:900, lineHeight:1 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Review queue */}
      {needsReview.length > 0 && (
        <div>
          <div style={{ fontFamily:MONO, color:T.red, fontSize:13, letterSpacing:2, marginBottom:12 }}>🔴 REVIEW QUEUE — NEEDS ATTENTION NOW</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {needsReview.map(r=>{
              const urg=getUrgency(r.confidence,r.lastStudied), u=URG[urg], conf=r.confidence?getConf(r.confidence):null, days=daysSince(r.lastStudied);
              const cardBg = (urg==="critical"||urg==="overdue") && !isDark ? (urg==="critical"?T.redBg:T.amberBg) : u.bg;
              const cardGlow = urg==="critical" && (isDark ? u.glow : "0 0 14px "+T.red+"26") || (urg==="overdue" && (isDark ? u.glow : "0 0 8px "+T.amber+"26")) || "none";
              return (
                <div key={r.id} style={{ background:cardBg, border:"1px solid "+u.border, borderRadius:10, padding:"12px 18px",
                  display:"flex", alignItems:"center", gap:16, boxShadow:cardGlow }}>
                  <div style={{ width:3, height:36, background:u.color, borderRadius:2, flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:MONO, color:T.text2, fontSize:14, fontWeight:600 }}>{r.topic}</div>
                    <div style={{ fontFamily:MONO, color:T.text3, fontSize:14 }}>{r.block} · {r.subject}</div>
                  </div>
                  {conf && <div style={{ display:"flex", alignItems:"center", gap:5, background:isDark?conf.bg:conf.color+"26", border:"1px solid "+conf.color, borderRadius:6, padding:"4px 10px", flexShrink:0 }}>
                    <div style={{ width:10,height:10,borderRadius:"50%",background:conf.color }}/><span style={{ fontFamily:MONO,color:conf.color,fontSize:13 }}>{conf.label}</span>
                  </div>}
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontFamily:MONO, color:u.color, fontSize:18, fontWeight:700 }}>{days!==null?days+"d ago":"Never studied"}</div>
                    <div style={{ fontFamily:MONO, color:u.color, background:isDark?u.color+"18":u.color+"26", fontSize:13, padding:"2px 7px", borderRadius:3, letterSpacing:1, marginTop:2 }}>{u.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confidence breakdown */}
      <div>
        <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:2, marginBottom:12 }}>CONFIDENCE BREAKDOWN</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {CONFIDENCE.map(c=>{
            const d=byConf[c.value]; if(!d||d.count===0) return null;
            const a=avg(d.scores);
            return (
              <div key={c.value} style={{ background:c.bg, border:"1px solid "+c.border, borderRadius:10, padding:"13px 16px", minWidth:140 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <div style={{ width:10,height:10,borderRadius:"50%",background:c.color }}/><span style={{ fontFamily:MONO,color:c.color,fontSize:13,fontWeight:600 }}>{c.label}</span>
                </div>
                <div style={{ fontFamily:SERIF, color:c.color, fontSize:26, fontWeight:900 }}>{d.count}</div>
                <div style={{ fontFamily:MONO, color:T.text4, fontSize:13 }}>topic{d.count!==1?"s":""}{a!==null?" · "+a+"%":""}</div>
                <div style={{ fontFamily:MONO, color:T.text5, fontSize:13, marginTop:3 }}>review every {c.reviewDays}d</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* By subject */}
      <div>
        <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:2, marginBottom:12 }}>BY SUBJECT — WEAKEST FIRST</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:10 }}>
          {Object.entries(bySubject).sort((a,b)=>(avg(a[1].scores)??101)-(avg(b[1].scores)??101)).map(([subj,d])=>{
            const a=avg(d.scores), col=acol(a);
            const avgConf=d.conf.length?Math.round(d.conf.reduce((s,v)=>s+v,0)/d.conf.length):null;
            const confData=avgConf?getConf(Math.round(avgConf)):null;
            return (
              <div key={subj} style={{ background:T.cardBg, border:"1px solid "+(confData?confData.color+"25":T.border1), borderRadius:10, padding:"13px 16px", boxShadow:T.shadowSm }}>
                <div style={{ fontFamily:MONO, color:T.text2, fontSize:14, fontWeight:600, marginBottom:8 }}>{subj}</div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <span style={{ fontFamily:SERIF, color:col, fontSize:24, fontWeight:900 }}>{a!==null?a+"%":"—"}</span>
                  {confData && <div style={{ display:"flex", alignItems:"center", gap:4, background:confData.bg, border:"1px solid "+confData.border, borderRadius:5, padding:"3px 8px" }}>
                    <div style={{ width:10,height:10,borderRadius:"50%",background:confData.color }}/><span style={{ fontFamily:MONO,color:confData.color,fontSize:13 }}>{confData.label}</span>
                  </div>}
                </div>
                {a!==null && <div style={{ height:3,background:T.border1,borderRadius:2,marginBottom:8 }}><div style={{ width:a+"%",height:"100%",background:col,borderRadius:2 }}/></div>}
                <div style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>{d.count} lecture{d.count!==1?"s":""} · {d.scores.length} scores</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────
function deduplicateTrackerRows(rows) {
  const seen = {};
  const merged = [];
  rows.forEach((row) => {
    const key = row.lectureId || (row.topic || "").toLowerCase().trim() || row.id;
    if (seen[key] !== undefined) {
      const existing = merged[seen[key]];
      const combinedScores = [...(existing.scores || []), ...(row.scores || [])].filter((s) => s != null && s !== "");
      merged[seen[key]] = {
        ...existing,
        lastStudied: [existing.lastStudied, row.lastStudied].filter(Boolean).sort().slice(-1)[0] || existing.lastStudied,
        reps: (existing.reps || 0) + (row.reps || 0),
        scores: combinedScores,
        confidence: row.confidence ?? existing.confidence,
        ankiDate: row.ankiDate || existing.ankiDate,
        lectureDate: row.lectureDate || existing.lectureDate,
        preRead: existing.preRead || row.preRead,
        lecture: existing.lecture || row.lecture,
        postReview: existing.postReview || row.postReview,
        anki: existing.anki || row.anki,
      };
    } else {
      seen[key] = merged.length;
      merged.push({ ...row });
    }
  });
  return merged;
}

// Lectures tab content — extracted so hooks run only when tab is active
function LecturesTabContent({
  blockId: bid,
  examDate: examDateForBlock,
  todayISO,
  completion,
  setCompletion,
  lecs,
  completionKey,
  getCompletion,
  markLectureComplete,
  logActivity,
  updateAnkiCounts,
  logReview,
  computeReviewDates,
  getLectureActivitySummary,
  getConfidenceTrend,
  theme: t,
  MONO,
}) {
  const loadBlockLecs = () => {
    try {
      const raw = JSON.parse(localStorage.getItem("rxt-lecs") || "[]");
      if (Array.isArray(raw) && raw.length) return raw;
    } catch {}
    return lecs || [];
  };

  const allLecs = loadBlockLecs();
  const blockLecs = (allLecs || []).filter((l) => l && l.blockId === bid);
  const completions = completion || {};

  function buildLectureGroups(blockLecsIn, completionsIn, blockId) {
    const groupsMap = {};
    blockLecsIn.forEach((lec) => {
      const week = lec.weekNumber ?? "unscheduled";
      const type = (lec.lectureType ?? "other").toUpperCase();
      const key = `${week}__${type}`;
      if (!groupsMap[key]) groupsMap[key] = { week, type, lectures: [] };
      groupsMap[key].lectures.push(lec);
    });
    return Object.values(groupsMap).map((g) => {
      const entries = g.lectures.map((lec) => ({
        lec,
        entry: completionsIn[`${lec.id}__${blockId}`] || null,
      }));
      const tracked = entries.filter((e) => e.entry?.activityLog?.length > 0).length;
      const struggling = entries.filter((e) => e.entry?.lastConfidence === "struggling").length;
      const okay = entries.filter((e) => e.entry?.lastConfidence === "okay").length;
      const good = entries.filter((e) => e.entry?.lastConfidence === "good").length;
      const untouched = entries.filter((e) => !e.entry || !e.entry.activityLog?.length).length;
      const level =
        struggling > 0 ? "critical"
        : okay > 0 && okay >= g.lectures.length / 2 ? "weak"
        : untouched > 0 ? "gaps"
        : "strong";
      const avgConf = entries.length
        ? entries.reduce((sum, e) => {
            const m = { good: 3, okay: 2, struggling: 1 };
            return sum + (m[e.entry?.lastConfidence] || 0);
          }, 0) / entries.length
        : 0;
      return {
        ...g,
        entries,
        tracked,
        struggling,
        okay,
        good,
        untouched,
        level,
        avgConf,
        total: g.lectures.length,
      };
    }).sort((a, b) => {
      const order = { critical: 0, weak: 1, gaps: 2, strong: 3 };
      if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
      const wa = a.week === "unscheduled" ? 9999 : Number(a.week);
      const wb = b.week === "unscheduled" ? 9999 : Number(b.week);
      return wa - wb;
    });
  }

  const groups = buildLectureGroups(blockLecs, completions, bid);

  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState({});
  const [expandedLecId, setExpandedLecId] = useState(null);
  const [openRow, setOpenRow] = useState(null);
  const [formByLec, setFormByLec] = useState(() => ({}));
  const [editByLec, setEditByLec] = useState(() => ({}));
  const [reviewFlowByLec, setReviewFlowByLec] = useState(() => ({}));
  const [activityFlowByLec, setActivityFlowByLec] = useState(() => ({}));
  const [ankiCountsByLec, setAnkiCountsByLec] = useState(() => ({}));

  useEffect(() => {
    queueMicrotask(() => setSearchQuery(""));
  }, [typeFilter]);

  const filteredGroups = groups
    .map((g) => {
      if (typeFilter !== "all" && g.type !== typeFilter) return null;
      if (!searchQuery.trim()) return g;
      const q = searchQuery.toLowerCase();
      const matchingLecs = g.entries.filter(
        ({ lec }) =>
          lec.title?.toLowerCase().includes(q) ||
          lec.lectureTitle?.toLowerCase().includes(q) ||
          String(lec.lectureNumber).includes(q) ||
          (lec.lectureType ?? "").toLowerCase().includes(q)
      );
      if (matchingLecs.length === 0) return null;
      return { ...g, entries: matchingLecs, _searchFiltered: true };
    })
    .filter(Boolean);

  const getNextReview = (entry) => {
    const rd = Array.isArray(entry?.reviewDates) ? entry.reviewDates : [];
    const done = Array.isArray(entry?.reviewsCompleted) ? entry.reviewsCompleted : [];
    return rd.find((d) => d >= todayISO && !done.includes(d)) || null;
  };

  const dueStateForDate = (entry, dateStr) => {
    const rd = Array.isArray(entry?.reviewDates) ? entry.reviewDates : [];
    const done = Array.isArray(entry?.reviewsCompleted) ? entry.reviewsCompleted : [];
    if (done.includes(dateStr)) return "done";
    if (dateStr <= todayISO && rd.includes(dateStr)) return "due";
    if (rd.includes(dateStr)) return "upcoming";
    return "none";
  };

  const confidenceBadge = (val) => {
    const v = String(val || "okay");
    if (v === "good") return { label: "✓ Good", color: t.statusGood };
    if (v === "struggling") return { label: "⚠ Struggling", color: t.statusBad };
    return { label: "△ Okay", color: t.statusWarn };
  };

  const typePillStyle = (type, active) => {
    const map = { All: { bg: t.inputBg, fg: t.text1 }, DLA: { bg: "#EEEDFE", fg: "#3C3489" }, LEC: { bg: "#E6F1FB", fg: "#0C447C" }, SG: { bg: "#E1F5EE", fg: "#085041" }, TBL: { bg: "#FAEEDA", fg: "#633806" } };
    const k = type === "all" ? "All" : (type || "LEC").toUpperCase();
    const c = map[k] || map.LEC;
    if (active) return { background: c.bg, color: c.fg, border: "none" };
    return { background: "transparent", color: t.text2, border: "0.5px solid " + t.border2 };
  };

  const progressFillColor = (level) => ({ critical: "#E24B4A", weak: "#BA7517", gaps: "#888780", strong: "#639922" }[level] || "#888780");
  const statusPillConfig = (g) => {
    if (g.level === "critical") return { text: `⚠ ${g.struggling} struggling`, ...t.statusBadBg != null ? { bg: t.statusBadBg, border: t.statusBadBorder, color: t.statusBad } : { bg: t.statusBad + "15", border: t.statusBad, color: t.statusBad } };
    if (g.level === "weak") return { text: "△ Weak", ...t.statusWarnBg != null ? { bg: t.statusWarnBg, border: t.statusWarnBorder, color: t.statusWarn } : { bg: t.statusWarn + "15", border: t.statusWarn, color: t.statusWarn } };
    if (g.level === "gaps") return { text: `○ ${g.untouched} untouched`, color: t.text3, bg: "transparent", border: t.border2 };
    return { text: "✓ Strong", ...t.statusGoodBg != null ? { bg: t.statusGoodBg, border: t.statusGoodBorder, color: t.statusGood } : { bg: t.statusGood + "15", border: t.statusGood, color: t.statusGood } };
  };
  const getTrackerObjectivesForBlock = (blockId) => {
    try {
      const stored = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
      const blockData = stored[blockId] || stored["msk"] || {};
      if (Array.isArray(blockData)) return blockData;
      const out = [];
      Object.values(blockData || {}).forEach((val) => {
        if (Array.isArray(val)) out.push(...val);
      });
      return out;
    } catch {
      return [];
    }
  };
  const getLecQuestionLevel = (lec) => {
    const objs = getTrackerObjectivesForBlock(lec?.blockId || bid || "msk").filter(
      (o) => o.linkedLecId === lec.id
    );
    if (objs.length === 0) return "1st";
    const avgConsecutive =
      objs.reduce((sum, o) => sum + (o.consecutiveCorrect || 0), 0) / objs.length;
    if (avgConsecutive >= 2) return "3rd";
    if (avgConsecutive >= 1) return "2nd";
    return "1st";
  };
  const startTrackerQuestionSession = (lec) => {
    window.dispatchEvent(
      new CustomEvent("rxt-start-drill", {
        detail: {
          lecId: lec.id,
          lecTitle: lec.lectureTitle,
          mode: "mcq",
          filter: "all",
        },
      })
    );
  };

  if (blockLecs.length === 0) {
    return <div style={{ textAlign: "center", color: t.text3, padding: 24 }}>No lectures uploaded for this block yet.</div>;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {["all", "DLA", "LEC", "SG", "TBL"].map((type) => {
          const active = typeFilter === type;
          const style = { fontSize: 12, padding: "4px 10px", borderRadius: 20, cursor: "pointer", boxShadow: "none", fontFamily: MONO, ...typePillStyle(type, active) };
          return (
            <button key={type} type="button" onClick={() => setTypeFilter(type)} style={style}>
              {type === "all" ? "All" : type}
            </button>
          );
        })}
        <input
          type="text"
          placeholder="Search lectures..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ marginLeft: "auto", width: 180, background: t.inputBg, border: "0.5px solid " + t.border2, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 12, outline: "none" }}
        />
      </div>

      {filteredGroups.length === 0 ? (
        <div style={{ textAlign: "center", color: t.text3, padding: 24 }}>
          No lectures match your filter.
          <button type="button" onClick={() => { setTypeFilter("all"); setSearchQuery(""); }} style={{ marginLeft: 8, color: t.statusProgress, background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 12, textDecoration: "underline" }}>Clear filters</button>
        </div>
      ) : (
        filteredGroups.map((g) => {
          const groupKey = `${g.week}__${g.type}`;
          const isGroupExpanded = searchQuery.trim() ? true : (expandedGroups[groupKey] !== undefined ? expandedGroups[groupKey] : (g.level === "critical" || g.level === "weak"));
          const statusCfg = statusPillConfig(g);
          return (
            <div key={groupKey} style={{ background: t.cardBg, border: "0.5px solid " + t.border2, borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
              <div
                onClick={() => setExpandedGroups((prev) => ({ ...prev, [groupKey]: !isGroupExpanded }))}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: t.inputBg, cursor: "pointer" }}
              >
                <span style={{ fontSize: 10, color: t.text3 }}>{isGroupExpanded ? "▾" : "▸"}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, padding: "4px 10px", borderRadius: 20, ...typePillStyle(g.type, true) }}>{g.type}</span>
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{g.week === "unscheduled" ? "Unscheduled" : `Week ${g.week}`}</span>
                <span style={{ fontSize: 11, color: t.text3 }}>{g.entries.length} / {g.total} lectures</span>
                <span style={{ fontFamily: MONO, fontSize: 11, padding: "3px 8px", borderRadius: 20, background: statusCfg.bg, border: "1px solid " + (statusCfg.border || t.border2), color: statusCfg.color, fontWeight: 700 }}>{statusCfg.text}</span>
              </div>
              <div style={{ height: 4, background: t.border2 }}>
                <div style={{ width: `${(g.tracked / g.total) * 100}%`, height: "100%", background: progressFillColor(g.level), transition: "width 0.3s ease" }} />
              </div>
              {isGroupExpanded && (
                <div>
                  {g.entries.map(({ lec, entry }) => {
                    const isTracked = !!entry?.activityLog?.length;
                    const isExpanded = expandedLecId === lec.id;
                    const isOpenUntracked = openRow === lec.id;
                    const form = formByLec[lec.id] || { completedDate: todayISO, ankiInRotation: false, confidenceRating: "okay" };
                    const reviewFlow = reviewFlowByLec[lec.id] || null;
                    const activitySummary = getLectureActivitySummary(lec.id, bid);
                    const confidenceTrend = getConfidenceTrend(entry?.activityLog || [], t);
                    const rowStatus = mergeTrackerDisplayStatus(lec.id, bid, entry?.lastConfidence);
                    const confScore = rowStatus === "good" ? 3 : rowStatus === "okay" ? 2 : rowStatus === "struggling" ? 1 : 0;
                    const confBarColor = rowStatus === "good" ? "#639922" : rowStatus === "okay" ? "#BA7517" : rowStatus === "struggling" ? "#E24B4A" : "transparent";
                    const trendColor = confidenceTrend.trend === "improving" ? "#639922" : confidenceTrend.trend === "declining" || confidenceTrend.trend === "stuck" ? "#E24B4A" : confidenceTrend.arrow ? "#BA7517" : t.text3;
                    const dotColor = rowStatus === "good" ? "#639922" : rowStatus === "okay" ? "#BA7517" : rowStatus === "struggling" ? "#E24B4A" : null;
                    const interactionCount = entry?.activityLog?.length ?? 0;
                    const title = lec.lectureTitle || lec.title || lec.filename || "";
                    return (
                      <React.Fragment key={lec.id}>
                        <div
                          onClick={() => {
                            if (isTracked) setExpandedLecId(isExpanded ? null : lec.id);
                            else setOpenRow(isOpenUntracked ? null : lec.id);
                          }}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            padding: "10px 12px",
                            borderBottom: "0.5px solid " + t.border2,
                            cursor: "pointer",
                            transition: "background 0.15s",
                            background: isExpanded ? t.inputBg : undefined,
                            borderLeft: isExpanded ? "3px solid #0891b2" : undefined,
                            width: "100%",
                            maxWidth: "100%",
                            boxSizing: "border-box",
                          }}
                          onMouseEnter={(e) => {
                            if (!isExpanded) e.currentTarget.style.background = t.inputBg;
                          }}
                          onMouseLeave={(e) => {
                            if (!isExpanded) e.currentTarget.style.background = "";
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", width: "100%", minWidth: 0 }}>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 14,
                                fontWeight: 600,
                                fontFamily: MONO,
                                color: t.text1,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {title}
                            </span>
                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => {
                                  window.dispatchEvent(
                                    new CustomEvent("rxt-launch-deeplearn", {
                                      detail: { lecId: lec.id, blockId: bid },
                                    })
                                  );
                                }}
                                title="Deep Learn — guided teaching"
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 6,
                                  border: `1px solid #dc2626`,
                                  background: "transparent",
                                  color: "#dc2626",
                                  cursor: "pointer",
                                  fontSize: 14,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                🧠
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  window.dispatchEvent(
                                    new CustomEvent("rxt-start-drill", {
                                      detail: { lecId: lec.id, blockId: bid },
                                    })
                                  );
                                }}
                                title="Drill — rapid objective self-assess"
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 6,
                                  border: `1px solid ${t?.accent || "#2563eb"}`,
                                  background: "transparent",
                                  color: t?.accent || "#2563eb",
                                  cursor: "pointer",
                                  fontSize: 14,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                ⚡
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  window.dispatchEvent(
                                    new CustomEvent("rxt-launch-quiz", {
                                      detail: { lecId: lec.id, blockId: bid },
                                    })
                                  );
                                }}
                                title="Quiz — AI clinical MCQs"
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 6,
                                  border: `1px solid #d97706`,
                                  background: "transparent",
                                  color: "#d97706",
                                  cursor: "pointer",
                                  fontSize: 14,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                📝
                              </button>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: MONO, fontSize: 10, color: t.text3, flexShrink: 0 }}>
                              {(lec.lectureType || "LEC").toUpperCase()} {lec.lectureNumber ?? ""}
                            </span>
                            <div style={{ width: 48, height: 5, borderRadius: 3, background: t.border2, flexShrink: 0, overflow: "hidden" }}>
                              <div style={{ width: `${(confScore / 3) * 100}%`, height: "100%", background: confBarColor, borderRadius: 3 }} />
                            </div>
                            <span style={{ flexShrink: 0, fontSize: 13, minWidth: 16, textAlign: "center", color: trendColor }}>{confidenceTrend.arrow ?? "—"}</span>
                            <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 11, color: t.text3, minWidth: 28, textAlign: "right" }}>{interactionCount}x</span>
                            <div
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                flexShrink: 0,
                                background: dotColor || "transparent",
                                border: dotColor ? "none" : "1px solid " + t.border2,
                              }}
                            />
                          </div>
                        </div>
                        {isTracked && isExpanded && (
                          <div style={{ padding: "12px 12px 16px 52px", borderBottom: "0.5px solid " + t.border2, background: t.cardBg }}>
                            {(() => {
                              const badge = confidenceBadge(entry?.confidenceRating ?? entry?.lastConfidence);
                              const rd = Array.isArray(entry?.reviewDates) ? entry.reviewDates : [];
                              const lastActKey = entry?.lastActivityDate ? String(entry.lastActivityDate).slice(0, 10) : null;
                              const dueTodayOrOver = rd.some((d) => d <= todayISO) && lastActKey !== todayISO;
                              const ankiTotal = entry?.ankiCardCount ?? null;
                              const ankiOverdue = entry?.ankiCardsOverdue ?? null;
                              const ankiLine = (() => {
                                if (!entry?.ankiInRotation) return null;
                                if (ankiTotal == null && ankiOverdue == null) return null;
                                const total = ankiTotal ?? 0;
                                const ovd = ankiOverdue ?? 0;
                                const ratio = total > 0 ? ovd / total : 0;
                                const col = ratio > 0.5 ? t.statusBad : ovd > 0 ? t.statusWarn : t.statusGood;
                                const sym = ratio > 0.5 ? "⚠" : ovd > 0 ? "△" : "✓";
                                return { text: `🃏 ${total} cards in Anki · ${ovd} overdue`, color: col, sym };
                              })();
                              const nextReview = getNextReview(entry);
                              const edit = editByLec[lec.id] || null;
                              const reviewFlow = reviewFlowByLec[lec.id] || null;
                              return (
                                <>
                                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                                    <span style={{ fontFamily: MONO, fontSize: 11, color: t.text2 }}>Completed: <b>{entry.completedDate}</b></span>
                                    <span style={{ fontFamily: MONO, fontSize: 11, color: t.text2 }}>Anki: {entry.ankiInRotation ? "✓ in rotation" : "○ not in rotation"}</span>
                                    {entry.ankiInRotation && ankiLine && (
                                      <span style={{ fontFamily: MONO, fontSize: 11, color: ankiLine.color, fontWeight: 900 }}>🃏 {ankiOverdue != null ? `${ankiOverdue} overdue` : "in Anki"}</span>
                                    )}
                                    <span style={{ fontFamily: MONO, fontSize: 11, color: badge.color, fontWeight: 900 }}>{badge.label}</span>
                                    {nextReview && (
                                      <span style={{ fontFamily: MONO, fontSize: 11, color: dueTodayOrOver ? t.statusWarn : t.text2, fontWeight: dueTodayOrOver ? 900 : 600 }}>
                                        {dueTodayOrOver ? "△" : "🔁"} Next: {new Date(nextReview + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                      </span>
                                    )}
                                  </div>
                                  {entry.ankiInRotation && (
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                                      <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>🃏 Anki cards:</span>
                                      <input type="number" min="0" placeholder="0" value={ankiCountsByLec[lec.id]?.cardCount ?? ankiTotal ?? ""} onChange={(e) => setAnkiCountsByLec((p) => ({ ...(p || {}), [lec.id]: { ...(p?.[lec.id] || {}), cardCount: e.target.value } }))} style={{ width: 90, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                      <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>Overdue cards:</span>
                                      <input type="number" min="0" placeholder="0" value={ankiCountsByLec[lec.id]?.overdueCount ?? ankiOverdue ?? ""} onChange={(e) => setAnkiCountsByLec((p) => ({ ...(p || {}), [lec.id]: { ...(p?.[lec.id] || {}), overdueCount: e.target.value } }))} style={{ width: 90, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                      <button type="button" onClick={() => { const ccRaw = ankiCountsByLec[lec.id]?.cardCount; const ocRaw = ankiCountsByLec[lec.id]?.overdueCount; const cc = ccRaw === "" || ccRaw == null ? null : parseInt(String(ccRaw), 10); const oc = ocRaw === "" || ocRaw == null ? null : parseInt(String(ocRaw), 10); updateAnkiCounts(lec.id, bid, Number.isNaN(cc) ? null : cc, Number.isNaN(oc) ? null : oc); }} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: t.statusProgress, color: "#fff", cursor: "pointer", fontWeight: 900 }}>Save</button>
                                    </div>
                                  )}
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                                    {rd.map((d) => { const st = dueStateForDate(entry, d); const isDone = st === "done"; const isDue = st === "due"; const border = isDone ? t.statusGood : isDue ? t.statusWarn : (t.statusNeutral || t.border1); const bg = isDone ? t.statusGood : isDue ? t.statusWarn : "transparent"; return <div key={d} title={d} style={{ width: 10, height: 10, borderRadius: 999, border: "1.5px solid " + border, background: bg }} />; })}
                                  </div>
                                  {Array.isArray(entry?.activityLog) && entry.activityLog.length > 0 && (
                                    <div style={{ marginBottom: 10 }}>
                                      <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, marginBottom: 6 }}>Activity log</div>
                                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        {entry.activityLog.map((act, ai) => {
                                          const iconMap = {
                                            deep_learn: "🧠",
                                            review: "📖",
                                            anki: "🃏",
                                            questions: "❓",
                                            notes: "📝",
                                            sg_tbl: "👥",
                                            manual: "✏️",
                                          };
                                          const ic = iconMap[act?.activityType] || "✏️";
                                          const dateStr = String(act?.date || "").slice(0, 10);
                                          const badge = confidenceBadge(act?.confidenceRating);
                                          const showQ =
                                            act?.activityType === "questions" &&
                                            act.questionCount != null &&
                                            Number(act.questionCount) > 0;
                                          const pct = showQ
                                            ? act.questionScore != null
                                              ? act.questionScore
                                              : Math.round(((act.correctCount ?? 0) / Number(act.questionCount)) * 100)
                                            : null;
                                          const chipStyle = pct != null ? questionSessionScoreChipStyle(pct) : null;
                                          return (
                                            <div
                                              key={act?.id || `${dateStr}-${ai}`}
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                                flexWrap: "wrap",
                                              }}
                                            >
                                              <span style={{ fontSize: 14 }}>{ic}</span>
                                              <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>{dateStr}</span>
                                              {showQ && chipStyle != null && (
                                                <span
                                                  style={{
                                                    fontFamily: MONO,
                                                    fontSize: 11,
                                                    padding: "2px 7px",
                                                    borderRadius: 20,
                                                    background: chipStyle.bg,
                                                    color: chipStyle.color,
                                                  }}
                                                >
                                                  {act.correctCount ?? 0}/{act.questionCount} · {pct}%
                                                </span>
                                              )}
                                              <span style={{ fontFamily: MONO, fontSize: 11, color: badge.color, fontWeight: 800 }}>
                                                {badge.label}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  {!reviewFlow && (
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                      <button
                                        type="button"
                                        onClick={() => startTrackerQuestionSession(lec)}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 6,
                                          padding: "8px 14px",
                                          fontSize: 13,
                                          fontWeight: 500,
                                          background: "#EEEDFE",
                                          color: "#3C3489",
                                          border: "0.5px solid #AFA9EC",
                                          borderRadius: 8,
                                          cursor: "pointer",
                                        }}
                                      >
                                        ⚡ Start questions
                                        <span
                                          style={{
                                            fontSize: 10,
                                            padding: "1px 6px",
                                            background: "#3C3489",
                                            color: "white",
                                            borderRadius: 10,
                                          }}
                                        >
                                          {getLecQuestionLevel(lec)} order
                                        </span>
                                      </button>
                                      <button type="button" onClick={() => setReviewFlowByLec((p) => ({ ...(p || {}), [lec.id]: { open: true, confidenceRating: "okay", date: todayISO } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: t.statusProgress, color: "#fff", cursor: "pointer", fontWeight: 900 }}>🔁 Log Review</button>
                                      <button type="button" onClick={() => setActivityFlowByLec((p) => ({ ...(p || {}), [lec.id]: { open: true, date: todayISO, activityType: "review", confidenceRating: "okay", durationMinutes: "", note: "", questionCount: "", correctCount: "", showWrongQuestions: false, wrongQuestions: [] } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: t.cardBg, color: t.text2, cursor: "pointer", fontWeight: 900 }}>＋ Log Activity</button>
                                      <button type="button" onClick={() => setEditByLec((p) => ({ ...(p || {}), [lec.id]: { open: true, completedDate: entry.completedDate, ankiInRotation: !!entry.ankiInRotation } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: t.cardBg, color: t.text2, cursor: "pointer", fontWeight: 800 }}>✎ Edit</button>
                                    </div>
                                  )}
                                  {activityFlowByLec?.[lec.id]?.open && (
                                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid " + t.border2 }}>
                                      {(() => {
                                        const flow = activityFlowByLec[lec.id];
                                        const setFlow = (patch) => setActivityFlowByLec((p) => ({ ...(p || {}), [lec.id]: { ...flow, ...patch } }));
                                        const selectedDate = flow?.date || todayISO;
                                        return (
                                          <>
                                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                                              <span style={{ fontFamily: MONO, fontSize: 11, color: t.statusNeutral || t.text4 }}>Date completed</span>
                                              <input type="date" value={selectedDate} max={todayISO} onChange={(e) => setFlow({ date: e.target.value })} style={{ background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                            </div>
                                            <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, marginBottom: 8 }}>Activity type</div>
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                                              {[{ v: "deep_learn", label: "🧠 Deep Learn" }, { v: "review", label: "📖 Review" }, { v: "anki", label: "🗂 Anki" }, { v: "questions", label: "❓ Questions" }, { v: "notes", label: "📝 Notes" }, { v: "sg_tbl", label: "👥 SG/TBL" }, { v: "manual", label: "✏️ Other" }].map((opt) => {
                                                const active = flow.activityType === opt.v;
                                                const accent = t.accent || t.statusProgress;
                                                return (
                                                  <button
                                                    key={opt.v}
                                                    type="button"
                                                    onClick={() =>
                                                      setFlow({
                                                        activityType: opt.v,
                                                        ...(opt.v !== "questions"
                                                          ? { questionCount: "", correctCount: "", showWrongQuestions: false, wrongQuestions: [] }
                                                          : {}),
                                                      })
                                                    }
                                                    style={{
                                                      fontFamily: MONO,
                                                      fontSize: 11,
                                                      padding: "4px 10px",
                                                      borderRadius: 20,
                                                      border: "1px solid " + (active ? accent : t.border1),
                                                      background: active ? accent : "transparent",
                                                      color: active ? "#fff" : (t.textSecondary || t.text2),
                                                      cursor: "pointer",
                                                      fontWeight: active ? 600 : 400,
                                                    }}
                                                  >
                                                    {opt.label}
                                                  </button>
                                                );
                                              })}
                                            </div>
                                            <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, marginBottom: 8 }}>How did it go?</div>
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                                              {[{ v: "good", label: "✓ Good", color: t.statusGood }, { v: "okay", label: "△ Okay", color: t.statusWarn }, { v: "struggling", label: "⚠ Struggling", color: t.statusBad }].map((opt) => {
                                                const active = flow.confidenceRating === opt.v;
                                                return <button key={opt.v} type="button" onClick={() => setFlow({ confidenceRating: opt.v })} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid " + (active ? opt.color : t.border1), background: active ? opt.color + "18" : t.cardBg, color: active ? opt.color : t.text2, cursor: "pointer", fontWeight: 900 }}>{opt.label}</button>;
                                              })}
                                            </div>
                                            {flow.activityType === "questions" && (
                                              <div style={{ marginTop: 10, marginBottom: 10, padding: "10px 12px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8 }}>
                                                <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                                                  Question session details
                                                </div>
                                                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                                                  <div style={{ flex: 1 }}>
                                                    <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 3 }}>
                                                      Questions done
                                                    </label>
                                                    <input
                                                      type="number"
                                                      min="1"
                                                      max="999"
                                                      value={flow.questionCount || ""}
                                                      onChange={(e) => setFlow({ questionCount: e.target.value })}
                                                      placeholder="40"
                                                      style={{ width: "100%", fontSize: 14, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, background: "var(--color-background-primary)", color: "var(--color-text-primary)", textAlign: "center" }}
                                                    />
                                                  </div>
                                                  <div style={{ fontSize: 18, color: "var(--color-text-tertiary)", paddingTop: 18, flexShrink: 0 }}>
                                                    /
                                                  </div>
                                                  <div style={{ flex: 1 }}>
                                                    <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 3 }}>
                                                      Correct
                                                    </label>
                                                    <input
                                                      type="number"
                                                      min="0"
                                                      max={flow.questionCount || 999}
                                                      value={flow.correctCount || ""}
                                                      onChange={(e) => setFlow({ correctCount: e.target.value })}
                                                      placeholder="32"
                                                      style={{ width: "100%", fontSize: 14, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, background: "var(--color-background-primary)", color: "var(--color-text-primary)", textAlign: "center" }}
                                                    />
                                                  </div>
                                                  {flow.questionCount && flow.correctCount && (
                                                    <div style={{ flexShrink: 0, paddingTop: 18, minWidth: 50, textAlign: "center" }}>
                                                      {(() => {
                                                        const pct = Math.round(parseInt(flow.correctCount, 10) / parseInt(flow.questionCount, 10) * 100);
                                                        return (
                                                          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-mono)", color: pct >= 70 ? "#27500A" : pct >= 50 ? "#BA7517" : "#A32D2D" }}>
                                                            {pct}%
                                                          </div>
                                                        );
                                                      })()}
                                                    </div>
                                                  )}
                                                </div>
                                                {flow.questionCount && flow.correctCount && !flow.confidenceRating && (
                                                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", display: "flex", alignItems: "center", gap: 8 }}>
                                                    <span>
                                                      Suggested: {(() => {
                                                        const pct = Math.round(parseInt(flow.correctCount, 10) / parseInt(flow.questionCount, 10) * 100);
                                                        return pct >= 70 ? "✓ Good" : pct >= 50 ? "△ Okay" : "⚠ Struggling";
                                                      })()}
                                                    </span>
                                                    <button
                                                      onClick={() => {
                                                        const pct = Math.round(parseInt(flow.correctCount, 10) / parseInt(flow.questionCount, 10) * 100);
                                                        setFlow({ confidenceRating: pct >= 70 ? "good" : pct >= 50 ? "okay" : "struggling" });
                                                      }}
                                                      style={{ fontSize: 11, padding: "2px 8px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 4, background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}
                                                    >
                                                      Apply
                                                    </button>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                                              <input value={flow.durationMinutes ?? ""} onChange={(e) => setFlow({ durationMinutes: e.target.value })} placeholder="Duration (min)" style={{ width: 140, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                              {flow.activityType === "anki" && <input value={flow.ankiOverdueCount ?? ""} onChange={(e) => setFlow({ ankiOverdueCount: e.target.value })} placeholder="Update overdue? (cards)" style={{ width: 190, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />}
                                              <input value={flow.note ?? ""} onChange={(e) => setFlow({ note: e.target.value })} placeholder="Note (optional)" style={{ flex: 1, minWidth: 200, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                            </div>
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                              <button type="button" onClick={() => { const dur = flow.durationMinutes != null && String(flow.durationMinutes).trim() !== "" ? parseInt(String(flow.durationMinutes), 10) : null; const options = { durationMinutes: Number.isNaN(dur) ? null : dur, note: flow.note ? String(flow.note).trim() : null, date: selectedDate, examDate: examDateForBlock }; if (flow.activityType === "questions" && flow.questionCount) { const total = parseInt(flow.questionCount, 10) || 0; const correct = parseInt(flow.correctCount, 10) || 0; options.questionCount = total; options.correctCount = correct; options.questionScore = total > 0 ? Math.round((correct / total) * 100) : null; options.note = options.note || `${correct}/${total} correct (${options.questionScore}%)`; } logActivity(lec.id, bid, flow.activityType, flow.confidenceRating, options); if (flow.activityType === "anki" && String(flow.ankiOverdueCount || "").trim() !== "") { const oc = parseInt(String(flow.ankiOverdueCount), 10); if (!Number.isNaN(oc)) updateAnkiCounts(lec.id, bid, null, oc); } setActivityFlowByLec((p) => ({ ...(p || {}), [lec.id]: null })); }} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: t.statusGood, color: "#fff", cursor: "pointer", fontWeight: 900 }}>Save ✓</button>
                                              <button type="button" onClick={() => setActivityFlowByLec((p) => ({ ...(p || {}), [lec.id]: null }))} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: t.cardBg, color: t.text3, cursor: "pointer" }}>Cancel</button>
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  )}
                                  {reviewFlow?.open && (
                                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid " + t.border2 }}>
                                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                                        <span style={{ fontFamily: MONO, fontSize: 11, color: t.statusNeutral || t.text4 }}>Date completed</span>
                                        <input type="date" value={reviewFlow.date || todayISO} max={todayISO} onChange={(e) => setReviewFlowByLec((p) => ({ ...(p || {}), [lec.id]: { ...reviewFlow, date: e.target.value } }))} style={{ background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                      </div>
                                      <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, marginBottom: 8 }}>How did it go?</div>
                                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                        {[{ v: "good", label: "✓ Good", color: t.statusGood }, { v: "okay", label: "△ Okay", color: t.statusWarn }, { v: "struggling", label: "⚠ Struggling", color: t.statusBad }].map((opt) => {
                                          const active = reviewFlow.confidenceRating === opt.v;
                                          return <button key={opt.v} type="button" onClick={() => setReviewFlowByLec((p) => ({ ...(p || {}), [lec.id]: { ...reviewFlow, confidenceRating: opt.v } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid " + (active ? opt.color : t.border1), background: active ? opt.color + "18" : t.cardBg, color: active ? opt.color : t.text2, cursor: "pointer", fontWeight: 900 }}>{opt.label}</button>;
                                        })}
                                        <button type="button" onClick={() => { logReview(lec.id, bid, reviewFlow.date || todayISO, reviewFlow.confidenceRating, examDateForBlock); setReviewFlowByLec((p) => ({ ...(p || {}), [lec.id]: null })); }} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: t.statusGood, color: "#fff", cursor: "pointer", fontWeight: 900 }}>Confirm ✓</button>
                                        <button type="button" onClick={() => setReviewFlowByLec((p) => ({ ...(p || {}), [lec.id]: null }))} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: t.cardBg, color: t.text3, cursor: "pointer" }}>Cancel</button>
                                      </div>
                                    </div>
                                  )}
                                  {edit?.open && (
                                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid " + t.border2 }}>
                                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                          <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>Completed:</span>
                                          <input type="date" value={edit.completedDate} onChange={(e) => setEditByLec((p) => ({ ...(p || {}), [lec.id]: { ...edit, completedDate: e.target.value } }))} style={{ background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                          <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>Anki?</span>
                                          <button type="button" onClick={() => setEditByLec((p) => ({ ...(p || {}), [lec.id]: { ...edit, ankiInRotation: !edit.ankiInRotation } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: edit.ankiInRotation ? t.statusGoodBg : t.cardBg, color: edit.ankiInRotation ? t.statusGood : t.text2, cursor: "pointer" }}>{edit.ankiInRotation ? "✓ Yes" : "○ No"}</button>
                                        </div>
                                        <div style={{ flex: 1 }} />
                                        <button type="button" onClick={() => { setCompletion((prev) => { const k = completionKey(lec.id, bid); const ex = (prev || {})[k]; if (!ex) return prev; const rd2 = computeReviewDates(edit.completedDate, ex.confidenceRating, examDateForBlock || null).map((d) => d.toISOString().slice(0, 10)); return { ...(prev || {}), [k]: { ...ex, completedDate: edit.completedDate, ankiInRotation: !!edit.ankiInRotation, reviewDates: rd2 } }; }); setEditByLec((p) => ({ ...(p || {}), [lec.id]: null })); }} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: t.statusGood, color: "#fff", cursor: "pointer", fontWeight: 900 }}>Save ✓</button>
                                        <button type="button" onClick={() => setEditByLec((p) => ({ ...(p || {}), [lec.id]: null }))} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: t.cardBg, color: t.text3, cursor: "pointer" }}>Cancel</button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                        {!isTracked && isOpenUntracked && (
                          <div style={{ padding: "10px 12px 52px", borderBottom: "0.5px solid " + t.border2, background: t.inputBg }}>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>Completed:</span>
                                <input type="date" value={form.completedDate} onChange={(e) => setFormByLec((p) => ({ ...(p || {}), [lec.id]: { ...form, completedDate: e.target.value } }))} style={{ background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>Anki?</span>
                                <button type="button" onClick={() => setFormByLec((p) => ({ ...(p || {}), [lec.id]: { ...form, ankiInRotation: !form.ankiInRotation } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: form.ankiInRotation ? t.statusGoodBg : t.cardBg, color: form.ankiInRotation ? t.statusGood : t.text2, cursor: "pointer" }}>{form.ankiInRotation ? "✓ Yes" : "○ No"}</button>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>How did it go?</span>
                                {[{ v: "good", label: "✓ Good", color: t.statusGood }, { v: "okay", label: "△ Okay", color: t.statusWarn }, { v: "struggling", label: "⚠ Struggling", color: t.statusBad }].map((opt) => {
                                  const active = form.confidenceRating === opt.v;
                                  return (
                                    <button key={opt.v} type="button" onClick={() => setFormByLec((p) => ({ ...(p || {}), [lec.id]: { ...form, confidenceRating: opt.v } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid " + (active ? opt.color : t.border1), background: active ? opt.color + "18" : t.cardBg, color: active ? opt.color : t.text2, cursor: "pointer", fontWeight: 800 }}>{opt.label}</button>
                                  );
                                })}
                              </div>
                              <div style={{ flex: 1 }} />
                              <button type="button" onClick={() => { markLectureComplete(lec.id, bid, form.completedDate, form.confidenceRating, form.ankiInRotation, examDateForBlock); setOpenRow(null); }} style={{ fontFamily: MONO, fontSize: 11, padding: "7px 12px", borderRadius: 8, border: "none", background: t.statusGood, color: "#fff", cursor: "pointer", fontWeight: 900 }}>Confirm ✓</button>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/** Visual + symbol for calendar heatmap (keys from getDayHeat: empty | scheduled | low | medium | high | overdue | struggling). */
function getCalendarHeatCellStyle(heat, t) {
  const textSec = t.text3;
  const styles = {
    empty: { bg: t.inputBg, symbol: "", fg: "transparent", border: "none" },
    scheduled: { bg: t.inputBg, symbol: "○", fg: textSec, border: `1px solid ${t.border1}` },
    low: { bg: t.statusProgressBg, symbol: "✓", fg: t.statusProgress, border: "none" },
    medium: { bg: t.statusProgress, symbol: "✓✓", fg: "#ffffff", border: "none" },
    high: { bg: t.statusGood, symbol: "★", fg: "#ffffff", border: "none" },
    overdue: { bg: t.statusWarnBg, symbol: "△", fg: t.statusWarn, border: "none" },
    struggling: { bg: t.statusBadBg, symbol: "⚠", fg: t.statusBad, border: "none" },
  };
  return styles[heat] || styles.empty;
}

const CALENDAR_HEAT_LEGEND_ORDER = ["empty", "scheduled", "low", "medium", "high", "overdue", "struggling"];
const CALENDAR_HEAT_LABELS = {
  empty: "No activity",
  scheduled: "Planned",
  low: "1 session",
  medium: "2–3 sessions",
  high: "4+ sessions",
  overdue: "Missed review",
  struggling: "Struggled",
};

// Calendar tab content — extracted so hooks run only when tab is active
function CalendarTabContent({
  blockId: bid,
  examDate,
  examDateInputOnChange, // must be the exact handler passed from Tracker
  completion,
  lecs,
  getPressureZone,
  logActivity,
  refreshAllData,
  refreshKey = 0,
  theme: t,
  MONO,
}) {
  const loadAllLecs = () => {
    try {
      const raw = JSON.parse(localStorage.getItem("rxt-lecs") || "[]");
      if (Array.isArray(raw) && raw.length) return raw;
    } catch {}
    return lecs || [];
  };

  const allLecs = loadAllLecs();
  const lecByIdMeta = loadLecMetaById();
  const lecById =
    Object.keys(lecByIdMeta).length > 0
      ? lecByIdMeta
      : Object.fromEntries((allLecs || []).filter((l) => l?.id).map((l) => [l.id, l]));
  const blockLecs = (allLecs || []).filter((l) => l && l.blockId === bid);
  const completions = completion || {};

  const [selectedDate, setSelectedDate] = useState(() => {
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    return t0;
  });
  const [calendarAnchor, setCalendarAnchor] = useState(() => {
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    t0.setDate(1);
    return t0;
  });

  function buildActivityIndex(completionsIn, blockId, lecByIdMap) {
    const index = {};
    Object.entries(completionsIn || {})
      .filter(([key, e]) => {
        if (!e || e.blockId !== blockId) return false;
        const lecId = e.lectureId || key.split("__")[0];
        return lecId && lecByIdMap[lecId];
      })
      .forEach(([key, e]) => {
        if (!e.activityLog) return;
        const lm = lecByIdMap[e.lectureId || key.split("__")[0]];
        const lecTitle = lm?.lectureTitle || lm?.title || lm?.fileName || "";
        e.activityLog.forEach((a) => {
          const day = String(a.date || "").split("T")[0];
          if (!day) return;
          if (!index[day]) index[day] = [];
          index[day].push({
            ...a,
            lectureId: e.lectureId || key.split("__")[0],
            lecTitle,
          });
        });
      });
    return index;
  }

  function buildReviewIndex(completionsIn, blockId, lecByIdMap) {
    const index = {};
    Object.entries(completionsIn || {})
      .filter(([key, e]) => {
        if (!e || e.blockId !== blockId) return false;
        const lecId = e.lectureId || key.split("__")[0];
        return lecId && lecByIdMap[lecId];
      })
      .forEach(([key, e]) => {
        if (!e.reviewDates) return;
        const lm = lecByIdMap[e.lectureId || key.split("__")[0]];
        const lecTitle = lm?.lectureTitle || lm?.title || lm?.fileName || "";
        e.reviewDates.forEach((d) => {
          const day = String(d || "").split("T")[0];
          if (!day) return;
          if (!index[day]) index[day] = [];
          index[day].push({
            lectureId: e.lectureId || key.split("__")[0],
            lecTitle,
            lastConfidence: e.lastConfidence,
          });
        });
      });
    return index;
  }

  const activityIndex = buildActivityIndex(completions, bid, lecById);
  const reviewIndex = buildReviewIndex(completions, bid, lecById);

  function getDayHeat(dateStr, activityIndexIn, reviewIndexIn) {
    const acts = activityIndexIn[dateStr] || [];
    const reviews = reviewIndexIn[dateStr] || [];
    const hasStruggling = acts.some((a) => a.confidenceRating === "struggling");
    const hasOverdue = (() => {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      const studyStart = startOfStudyDay();
      return reviews.length > 0 && d < studyStart && !acts.length;
    })();
    if (hasStruggling) return "struggling";
    if (hasOverdue) return "overdue";
    if (acts.length >= 4) return "high";
    if (acts.length >= 2) return "medium";
    if (acts.length === 1) return "low";
    if (reviews.length > 0) return "scheduled";
    return "empty";
  }

  const iso = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString().slice(0, 10);
  };

  const todayStr0 = useMemo(() => studyDayKeyNow(), [refreshKey]);
  const today = useMemo(() => {
    const d = new Date(todayStr0 + "T12:00:00");
    return d;
  }, [todayStr0]);
  const selectedDateStr = iso(selectedDate);
  const examDateStr = examDate ? String(examDate).slice(0, 10) : "";

  const pressure = examDate ? getPressureZone(examDate) : null;
  const countdown = (() => {
    if (!examDate) return null;
    const ex = new Date(examDateStr);
    ex.setHours(0, 0, 0, 0);
    const days = Math.ceil((ex - today) / (1000 * 60 * 60 * 24));
    if (days < 0) return { label: "Exam passed", color: t.text3, isPast: true };
    const zone = pressure?.zone || "normal";
    const color =
      zone === "critical" ? t.statusBad
      : zone === "crunch" ? t.statusWarn
      : zone === "build" ? t.statusProgress
      : zone === "exam" ? t.text3
      : t.statusGood;
    return { label: `${days} days`, color, isPast: false };
  })();

  const monthLabel = calendarAnchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const isAnchorCurrentMonth = calendarAnchor.getFullYear() === today.getFullYear() && calendarAnchor.getMonth() === today.getMonth();

  const gridDays = useMemo(() => {
    const firstOfMonth = new Date(calendarAnchor);
    firstOfMonth.setHours(0, 0, 0, 0);
    firstOfMonth.setDate(1);
    const start = new Date(firstOfMonth);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday

    const lastOfMonth = new Date(firstOfMonth);
    lastOfMonth.setMonth(lastOfMonth.getMonth() + 1);
    lastOfMonth.setDate(0); // last day of month
    lastOfMonth.setHours(0, 0, 0, 0);
    const end = new Date(lastOfMonth);
    end.setDate(end.getDate() + (6 - end.getDay())); // forward to Saturday

    const days = [];
    const cur = new Date(start);
    while (cur <= end) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [calendarAnchor]);

  const confPill = (conf) => {
    const c = String(conf || "okay");
    const map = {
      good: { label: "✓ Good", color: t.statusGood, bg: t.statusGoodBg, border: t.statusGoodBorder },
      okay: { label: "△ Okay", color: t.statusWarn, bg: t.statusWarnBg, border: t.statusWarnBorder },
      struggling: { label: "⚠ Struggling", color: t.statusBad, bg: t.statusBadBg, border: t.statusBadBorder },
    };
    const cfg = map[c] || map.okay;
    return (
      <span style={{ fontFamily: MONO, fontSize: 11, padding: "3px 9px", borderRadius: 999, background: cfg.bg, border: "1px solid " + cfg.border, color: cfg.color, fontWeight: 800 }}>
        {cfg.label}
      </span>
    );
  };

  const actIcon = (activityType) => {
    const t0 = String(activityType || "");
    const map = { deep_learn: "🧠", review: "📖", anki: "🃏", questions: "❓", notes: "📝", sg_tbl: "👥", manual: "✏️" };
    return map[t0] || "✏️";
  };

  // Quick log (calendar-local; does not touch Today tab state)
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickLectureId, setQuickLectureId] = useState("");
  const [quickDraft, setQuickDraft] = useState(() => ({ activityType: "review", confidenceRating: "okay", durationMinutes: "", note: "" }));

  const sortedBlockLecs = useMemo(() => {
    const toNum = (x) => {
      const n = parseInt(String(x ?? "").replace(/\D/g, ""), 10);
      return Number.isNaN(n) ? 0 : n;
    };
    return [...(blockLecs || [])].sort((a, b) => {
      const ta = String(a.lectureType || "LEC");
      const tb = String(b.lectureType || "LEC");
      if (ta !== tb) return ta.localeCompare(tb);
      return toNum(a.lectureNumber) - toNum(b.lectureNumber);
    });
  }, [bid, blockLecs]);

  const selectedActs = activityIndex[selectedDateStr] || [];
  const selectedReviews = reviewIndex[selectedDateStr] || [];

  const missedForLecture = (lectureId) => {
    if (selectedDateStr >= todayStr0) return false;
    if (selectedActs.some((a) => a.lectureId === lectureId)) return false;
    const lec = (blockLecs || []).find((l) => l?.id === lectureId) || null;
    const wasShownInTodayTab = (() => {
      if (!lec?.lectureDate) return false;
      try {
        const lecDay = String(lec.lectureDate).slice(0, 10);
        return lecDay === String(selectedDateStr).slice(0, 10);
      } catch {
        return false;
      }
    })();
    return wasShownInTodayTab;
  };

  return (
    <div style={{ padding: "0 16px 0", marginBottom: 28 }}>
      {/* Exam date row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: t.text2 }}>Exam date</span>
        <input
          type="date"
          value={examDate}
          min={new Date().toISOString().slice(0, 10)}
          onChange={examDateInputOnChange}
          style={{ background: t.inputBg, border: "1px solid " + t.border1, borderRadius: 7, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 12 }}
        />
        <div style={{ flex: 1 }} />
        {examDate && countdown && (
          countdown.isPast ? (
            <span style={{ fontFamily: MONO, fontSize: 12, color: t.text3 }}>Exam passed</span>
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 12, padding: "6px 10px", borderRadius: 999, border: "1px solid " + (countdown.color + "40"), background: countdown.color + "15", color: countdown.color, fontWeight: 900 }}>
              {countdown.label}
            </span>
          )
        )}
      </div>

      {/* Month navigation row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 10 }}>
        <button type="button" onClick={() => setCalendarAnchor((prev) => { const d = new Date(prev); d.setMonth(d.getMonth() - 1); return d; })} style={{ fontFamily: MONO, fontSize: 12, padding: "4px 8px", border: "1px solid " + t.border1, background: t.cardBg, color: t.text2, borderRadius: 8, cursor: "pointer" }}>◀</button>
        <div style={{ fontSize: 14, fontWeight: 500, color: t.text1 }}>{monthLabel}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={() => setCalendarAnchor((prev) => { const d = new Date(prev); d.setMonth(d.getMonth() + 1); return d; })} style={{ fontFamily: MONO, fontSize: 12, padding: "4px 8px", border: "1px solid " + t.border1, background: t.cardBg, color: t.text2, borderRadius: 8, cursor: "pointer" }}>▶</button>
          {!isAnchorCurrentMonth && (
            <button type="button" onClick={() => { const d = new Date(startOfStudyDay()); d.setHours(12, 0, 0, 0); const a = new Date(d); a.setDate(1); setCalendarAnchor(a); setSelectedDate(d); }} style={{ fontFamily: MONO, fontSize: 12, padding: "4px 10px", border: "1px solid " + t.border1, background: t.cardBg, color: t.text2, borderRadius: 8, cursor: "pointer" }}>Today</button>
          )}
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} style={{ fontSize: 10, color: t.text3, textAlign: "center", paddingBottom: 4, fontWeight: 500 }}>{d}</div>
        ))}
        {gridDays.map((d) => {
          const dateStr = iso(d);
          const inMonth = d.getMonth() === calendarAnchor.getMonth() && d.getFullYear() === calendarAnchor.getFullYear();
          const isSelected = dateStr === selectedDateStr;
          const isToday = dateStr === todayStr0;
          const heat = getDayHeat(dateStr, activityIndex, reviewIndex);
          const cellStyle = getCalendarHeatCellStyle(heat, t);
          return (
            <div
              key={dateStr}
              onClick={() => setSelectedDate(d)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "4px 2px",
                borderRadius: 4,
                cursor: "pointer",
                minHeight: 44,
                transition: "background 0.1s",
                background: isSelected ? (t.statusProgressBg || (t.statusProgress + "15")) : "transparent",
                opacity: inMonth ? 1 : 0.35,
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = t.inputBg; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ fontSize: 11, marginBottom: 2, fontWeight: isToday && !isSelected ? 500 : 400, color: isSelected ? t.statusProgress : t.text1 }}>
                {d.getDate()}
              </div>
              {isToday && !isSelected && <div style={{ width: 6, height: 2, borderRadius: 2, background: t.text1, marginTop: -2, marginBottom: 2 }} />}
              <div
                style={{
                  width: "100%",
                  height: 32,
                  borderRadius: 4,
                  background: cellStyle.bg,
                  border: cellStyle.border === "none" ? (heat === "empty" ? `1px solid ${t.border2}80` : "none") : cellStyle.border,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  color: cellStyle.symbol ? cellStyle.fg : "transparent",
                  position: "relative",
                }}
              >
                {cellStyle.symbol ? <span style={{ lineHeight: 1 }}>{cellStyle.symbol}</span> : null}
              </div>
              {examDateStr && dateStr === examDateStr && (
                <div style={{ marginTop: 2, fontSize: 8, color: "#E24B4A", fontFamily: MONO, fontWeight: 900 }}>EXAM</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Heat legend (symbol + color for colorblind access) */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {CALENDAR_HEAT_LEGEND_ORDER.map((heatKey) => {
          const st = getCalendarHeatCellStyle(heatKey, t);
          const legendBorder =
            st.border !== "none"
              ? st.border
              : heatKey === "empty"
                ? `1px solid ${t.border2}80`
                : "none";
          return (
            <div key={heatKey} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div
                style={{
                  width: 24,
                  height: 16,
                  background: st.bg,
                  borderRadius: 3,
                  border: legendBorder,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  color: st.symbol ? st.fg : t.text4 || t.text3,
                }}
              >
                {st.symbol || ""}
              </div>
              <span style={{ fontSize: 11, color: t.text3 }}>{CALENDAR_HEAT_LABELS[heatKey]}</span>
            </div>
          );
        })}
      </div>

      {/* Selected day detail panel */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: t.text1 }}>
            {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <div style={{ flex: 1 }} />
          {selectedDateStr === todayStr0 && (
            <span style={{ fontFamily: MONO, fontSize: 11, padding: "3px 9px", borderRadius: 999, background: t.statusProgressBg, border: "1px solid " + t.statusProgressBorder, color: t.statusProgress, fontWeight: 900 }}>
              Today
            </span>
          )}
        </div>
        <div style={{ borderTop: "0.5px solid " + t.border2, marginTop: 10 }} />

        {selectedActs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: t.text3, textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.06em" }}>Logged</div>
            {selectedActs.map((a, i) => {
              const showQ =
                a.activityType === "questions" &&
                a.questionCount != null &&
                Number(a.questionCount) > 0;
              const pct = showQ
                ? a.questionScore != null
                  ? a.questionScore
                  : Math.round(((a.correctCount ?? 0) / Number(a.questionCount)) * 100)
                : null;
              const chipStyle = pct != null ? questionSessionScoreChipStyle(pct) : null;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i === selectedActs.length - 1 ? "none" : "0.5px solid " + t.border2 }}>
                  <span style={{ fontSize: 14 }}>{actIcon(a.activityType)}</span>
                  <div style={{ fontSize: 13, color: t.text1, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.lecTitle}</div>
                  {showQ && chipStyle != null && (
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        padding: "2px 7px",
                        borderRadius: 20,
                        background: chipStyle.bg,
                        color: chipStyle.color,
                        flexShrink: 0,
                      }}
                    >
                      {a.correctCount ?? 0}/{a.questionCount} · {pct}%
                    </span>
                  )}
                  {confPill(mergeTrackerDisplayStatus(a.lectureId, bid, a.confidenceRating))}
                  {a.durationMinutes != null && String(a.durationMinutes).trim() !== "" && (
                    <div style={{ fontSize: 11, color: t.text3, fontFamily: MONO }}>{a.durationMinutes}m</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selectedReviews.length > 0 && (
          <div style={{ marginTop: selectedActs.length > 0 ? 12 : 12 }}>
            <div style={{ fontSize: 11, color: t.text3, textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.06em" }}>Reviews scheduled</div>
            {selectedReviews.map((r, i) => {
              const missed = missedForLecture(r.lectureId);
              const lec = (blockLecs || []).find((l) => l?.id === r.lectureId) || null;
              const isOverdue = (() => {
                const d = new Date(selectedDateStr);
                d.setHours(0, 0, 0, 0);
                return d < startOfStudyDay() && !selectedActs.some((a) => a.lectureId === r.lectureId);
              })();
              const due = isOverdue && !missed;
              const reviewStatus = mergeTrackerDisplayStatus(r.lectureId, bid, r.lastConfidence);
              const label =
                missed
                  ? "Missed"
                  : due
                    ? "Due"
                    : reviewStatus === "struggling"
                      ? "Struggling"
                      : "OK";
              const labelColor =
                label === "Missed" || label === "Struggling"
                  ? t.statusBad
                  : label === "Due"
                    ? t.statusWarn
                    : t.statusGood;
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 14px",
                    borderBottom: i === selectedReviews.length - 1 ? "none" : "0.5px solid " + t.border2,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, color: t.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.lecTitle}
                    </div>
                    <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>
                      {label} · {r.daysSinceReview || 0} days since review
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: labelColor, fontWeight: 600 }}>
                      △ {label}
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("rxt-launch-deeplearn", {
                              detail: { lecId: r.lectureId, blockId: bid },
                            })
                          )
                        }
                        title="Deep Learn"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: "1px solid #dc2626",
                          background: "transparent",
                          color: "#dc2626",
                          cursor: "pointer",
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        🧠
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("rxt-start-drill", {
                              detail: { lecId: r.lectureId, blockId: bid },
                            })
                          )
                        }
                        title="Drill"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: `1px solid ${t?.accent || "#2563eb"}`,
                          background: "transparent",
                          color: t?.accent || "#2563eb",
                          cursor: "pointer",
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ⚡
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("rxt-launch-quiz", {
                              detail: { lecId: r.lectureId, blockId: bid },
                            })
                          )
                        }
                        title="Quiz"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: "1px solid #d97706",
                          background: "transparent",
                          color: "#d97706",
                          cursor: "pointer",
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        📝
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selectedActs.length === 0 && selectedReviews.length === 0 && (
          <div style={{ marginTop: 12, color: t.text3, fontSize: 13 }}>
            {new Date(selectedDateStr) > today ? "Future date — nothing scheduled yet." : "Nothing logged on this day."}
          </div>
        )}

        {/* Quick log from calendar */}
        {new Date(selectedDateStr) <= today && (
          <div style={{ marginTop: 16 }}>
            {!quickOpen ? (
              <button type="button" onClick={() => setQuickOpen(true)} style={{ fontFamily: MONO, fontSize: 12, padding: "7px 10px", borderRadius: 10, border: "1px solid " + t.border1, background: t.cardBg, color: t.text2, cursor: "pointer", fontWeight: 800 }}>
                ＋ Log activity for this day
              </button>
            ) : (
              <div style={{ marginTop: 10, padding: 10, border: "1px solid " + t.border2, borderRadius: 12, background: t.inputBg }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                  <select value={quickLectureId} onChange={(e) => setQuickLectureId(e.target.value)} style={{ minWidth: 220, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }}>
                    <option value="">Select a lecture...</option>
                    {sortedBlockLecs.map((lec) => (
                      <option key={lec.id} value={lec.id}>
                        {(lec.lectureType || "LEC") + " " + (lec.lectureNumber ?? "") + " — " + (lec.lectureTitle || lec.title || lec.filename || "")}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>Date: {selectedDateStr}</div>
                  <div style={{ flex: 1 }} />
                  <button type="button" onClick={() => { setQuickOpen(false); setQuickLectureId(""); }} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: t.cardBg, color: t.text3, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>

                {quickLectureId && (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {[{ v: "review", label: "📖 Review" }, { v: "anki", label: "🃏 Anki" }, { v: "questions", label: "❓ Questions" }, { v: "notes", label: "📝 Notes" }, { v: "sg_tbl", label: "👥 SG/TBL" }, { v: "manual", label: "✏️ Other" }].map((opt) => {
                        const active = quickDraft.activityType === opt.v;
                        return (
                          <button key={opt.v} type="button" onClick={() => setQuickDraft((p) => ({ ...p, activityType: opt.v }))} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 999, border: "1px solid " + (active ? t.statusProgress : t.border1), background: active ? (t.statusProgressBg || (t.statusProgress + "18")) : t.cardBg, color: active ? t.statusProgress : t.text2, cursor: "pointer", fontWeight: 900 }}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                      {[{ v: "good", label: "✓ Good", color: t.statusGood }, { v: "okay", label: "△ Okay", color: t.statusWarn }, { v: "struggling", label: "⚠ Struggling", color: t.statusBad }].map((opt) => {
                        const active = quickDraft.confidenceRating === opt.v;
                        return (
                          <button key={opt.v} type="button" onClick={() => setQuickDraft((p) => ({ ...p, confidenceRating: opt.v }))} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid " + (active ? opt.color : t.border1), background: active ? opt.color + "18" : t.cardBg, color: active ? opt.color : t.text2, cursor: "pointer", fontWeight: 900 }}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                      <input value={quickDraft.durationMinutes} onChange={(e) => setQuickDraft((p) => ({ ...p, durationMinutes: e.target.value }))} placeholder="Duration (min)" style={{ width: 140, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                      <input value={quickDraft.note} onChange={(e) => setQuickDraft((p) => ({ ...p, note: e.target.value }))} placeholder="Note (optional)" style={{ flex: 1, minWidth: 200, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={() => {
                          const dur = quickDraft.durationMinutes != null && String(quickDraft.durationMinutes).trim() !== ""
                            ? parseInt(String(quickDraft.durationMinutes), 10)
                            : null;
                          logActivity(quickLectureId, bid, quickDraft.activityType, quickDraft.confidenceRating, {
                            durationMinutes: Number.isNaN(dur) ? null : dur,
                            note: quickDraft.note ? String(quickDraft.note).trim() : null,
                            date: selectedDateStr,
                            examDate,
                          });
                          refreshAllData && refreshAllData();
                          setQuickDraft({ activityType: "review", confidenceRating: "okay", durationMinutes: "", note: "" });
                          setQuickLectureId("");
                          setQuickOpen(false);
                        }}
                        style={{ fontFamily: MONO, fontSize: 11, padding: "7px 12px", borderRadius: 8, border: "none", background: t.statusGood, color: "#fff", cursor: "pointer", fontWeight: 900 }}
                      >
                        Save ✓
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Tracker({
  blocks = {},
  lecs = [],
  performanceHistory = {},
  objectives = {},
  reviewedLectures = {},
  activeSessions = {},
  getStudyCoachSteps = null,
  resolveTopicLabel,
  getBlockObjectives = () => [],
  computeWeakAreas = () => [],
  activeBlock = null,
  termColor,
  onStudyWeak,
  examDates = {},
  buildStudySchedule = () => null,
  generateDailySchedule = () => null,
  makeTopicKey,
  lecTypeBadge,
  onOpenBlockSchedule,
  saveExamDate,
  startObjectiveQuiz,
  handleDeepLearnStart,
  setAnkiLogTarget,
  LEVEL_COLORS = {},
  LEVEL_BG = {},
  updateBlock,
  onStartScheduleSession,
  onRealignObjectives,
  trackerRows: trackerRowsProp,
  setTrackerRows: setTrackerRowsProp,
  weakConceptsTabContent = null,
  weakConceptsBadgeCount = 0,
}) {
  const ACTIVITY_TYPES = [
    { id: "lecture", icon: "🎓", label: "Attended lecture" },
    { id: "video", icon: "▶", label: "Watched video" },
    { id: "deep_learn", icon: "🧠", label: "Deep Learn" },
    { id: "drill", icon: "⚡", label: "Drilled" },
    { id: "quiz", icon: "📝", label: "Quiz" },
    { id: "anki", icon: "🗂", label: "Anki" },
    { id: "read", icon: "📖", label: "Read slides" },
    { id: "sg", icon: "👥", label: "Small group" },
  ];

  /** Legacy Today/Reviews/Up Next quick-log rows: activity type per lecture+block (avoids one row's selection affecting another). */
  const [rowLogActivityTypeByKey, setRowLogActivityTypeByKey] = useState(() => ({}));
  const rowLogActivityRowKey = (lecId, blockId) => (lecId && blockId ? `${lecId}__${blockId}` : "");
  const rowLogActivityFor = (lecId, blockId) => rowLogActivityTypeByKey[rowLogActivityRowKey(lecId, blockId)] || "lecture";
  const setRowLogActivityFor = (lecId, blockId, typeId) => {
    const k = rowLogActivityRowKey(lecId, blockId);
    if (!k) return;
    setRowLogActivityTypeByKey((p) => ({ ...(p || {}), [k]: typeId }));
  };
  /** Unified Today list: per-lecture expand + activity + rating. */
  const [expandedTodayRow, setExpandedTodayRow] = useState(null);
  const [activityType, setActivityType] = useState({});
  const [selectedRating, setSelectedRating] = useState({});
  const [todayWhyOpen, setTodayWhyOpen] = useState(null);
  /** Unified Today expanded row: which lecture id has objectives list open (null = none). */
  const [showObjsFor, setShowObjsFor] = useState(null);
  /** Per-lecture: Study Coach “view all steps” roadmap in expanded Today row. */
  const [showAllSteps, setShowAllSteps] = useState({});
  /** Unified Today rows marked done this session (instant UI + survives until completion state matches). */
  const [unifiedDoneKeys, setUnifiedDoneKeys] = useState(() => new Set());
  /** Unified Today + Up Next: compact “✓ Logged” row immediately after mark (key = `${lecId}__${blockId}`). */
  const [doneSet, setDoneSet] = useState(() => new Set());
  /** Per-row session date for unified Today expanded log (key = `${lecId}__${blockId}`). */
  const [unifiedLogDateByRow, setUnifiedLogDateByRow] = useState(() => ({}));
  const [internalRows, setInternalRows] = useState([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("tracker");
  const [filter, setFilter] = useState("All");
  const [trackerBlockId, setTrackerBlockId] = useState(() => {
    try {
      if (activeBlock?.id) return activeBlock.id;
      const storedBlocks = JSON.parse(localStorage.getItem("rxt-blocks") || "[]");
      const active = (storedBlocks || []).find((b) => b?.status === "inprogress") || storedBlocks?.[0];
      return active?.id || null;
    } catch {
      return activeBlock?.id || null;
    }
  });
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [urgFilter, setUrgFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("block");
  const [todayFilter, setTodayFilter] = useState("all");
  const [todaySort, setTodaySort] = useState("urgency");
  const [todaySearch, setTodaySearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [showStudyLog, setShowStudyLog] = useState(false);
  const [coachExpanded, setCoachExpanded] = useState(false);
  const [showNotStarted, setShowNotStarted] = useState(false);
  const [showManualLog, setShowManualLog] = useState(false);
  const [openStudyLogGroups, setOpenStudyLogGroups] = useState(() => ({}));
  const todayKeyForSchedule = () => studyDayKeyNow();
  const [expandedScheduleDays, setExpandedScheduleDays] = useState(() => {
    const t = studyDayKeyNow();
    return { [t]: true };
  });
  const [collapsedScheduleTasks, setCollapsedScheduleTasks] = useState(() => new Set());
  const [overdueOpen, setOverdueOpen] = useState(() => ({}));
  const [snoozedToday, setSnoozedToday] = useState(() => ({})); // key -> YYYY-MM-DD
  const [weakAreaFilter, setWeakAreaFilter] = useState(() => null); // { week, type } | null
  const [weakAreaSummaryOpen, setWeakAreaSummaryOpen] = useState(false); // collapsed by default
  const [weakAreaShowStrong, setWeakAreaShowStrong] = useState(false);
  const [sweepMode, setSweepMode] = useState(false);
  const sweepModeEnteredDateRef = useRef(null);
  const [quickLogState, setQuickLogState] = useState(() => ({})); // { [lecId]: { open: boolean, submitting: boolean } }
  const [flashTaskId, setFlashTaskId] = useState(null); // { lecId, color } | null
  const [refreshKey, setRefreshKey] = useState(0);
  const [perfData, setPerfData] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-performance") || "{}");
    } catch {
      return {};
    }
  });
  const [completionData, setCompletionData] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-completion") || "{}");
    } catch {
      return {};
    }
  });
  const [quickLogNoteOpen, setQuickLogNoteOpen] = useState(() => ({})); // { [lecId]: boolean }
  const [quickLogDraft, setQuickLogDraft] = useState(() => ({})); // { [lecId]: { activityType, confidenceRating, note } }
  const [quickLogOpenId, setQuickLogOpenId] = useState(null); // Today tab only (single open at a time)
  /** Today tab — UP NEXT row expanded id (`${lecId}__${blockId}`) */
  const [expandedUpNext, setExpandedUpNext] = useState(null);
  /** UP NEXT: after compact "logged" row, show full form; keyed by lecture id (see also `lec._forceExpand`) */
  const [forceExpand, setForceExpand] = useState(() => ({}));
  /** Resolved block id for storage keys (`'all'` = no single block selected). Always a string, never a block object. */
  const activeBlockId = trackerBlockId ?? activeBlock?.id ?? null;
  const activeBlockFilter = useMemo(() => {
    const f = filter;
    if (f === "All" || f == null || String(f).trim() === "" || String(f).toLowerCase() === "all") {
      return "all";
    }
    const list = Object.values(blocks || {});
    const byId = list.find((b) => b && b.id === f);
    if (byId?.id) return String(byId.id);
    const byName = list.find(
      (b) => b && (b.name === f || String(b.name || "").trim() === String(f).trim())
    );
    if (byName?.id) return String(byName.id);
    if (activeBlockId) return String(activeBlockId);
    return "all";
  }, [filter, blocks, activeBlockId]);

  /** Objectives: prefer `rxt-block-objectives[tryBlock]`; otherwise flatten all blocks (covers filter/id edge cases). */
  const blockObjectives = useMemo(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
      const tryBlock = activeBlockFilter !== "all" ? activeBlockFilter : activeBlockId;
      const blockData = tryBlock ? stored[tryBlock] : null;
      if (blockData) {
        return Array.isArray(blockData) ? blockData : Object.values(blockData).filter(Array.isArray).flat();
      }
      return Object.values(stored).flatMap((bd) =>
        Array.isArray(bd) ? bd : Object.values(bd || {}).filter(Array.isArray).flat()
      );
    } catch {
      return [];
    }
  }, [activeBlockFilter, activeBlockId, refreshKey]);
  /** `${lectureId}__${blockId}` — optional wrong-questions-only panel on done cards */
  const [quickLogWrongOnlyKey, setQuickLogWrongOnlyKey] = useState(null);
  /** Brief flash under ✓ Done after logging weak concepts */
  const [weakConceptFlash, setWeakConceptFlash] = useState(null); // { key: string, count: number } | null

  function getTrackerObjectivesForBlock(blockId) {
    try {
      const stored = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
      const blockData = stored[blockId] || stored["msk"] || {};
      if (Array.isArray(blockData)) return blockData;
      const out = [];
      Object.values(blockData || {}).forEach((val) => {
        if (Array.isArray(val)) out.push(...val);
      });
      return out;
    } catch {
      return [];
    }
  }

  function getLecQuestionLevel(lec) {
    try {
      const stored = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
      const mskData = stored["msk"] || {};
      const allObjs = [...(mskData.imported || []), ...(mskData.extracted || [])];
      const lecObjs = allObjs.filter((o) => o.linkedLecId === lec.id);
      if (lecObjs.length === 0) return "1st";
      const avgConsecutive =
        lecObjs.reduce((sum, o) => sum + (o.consecutiveCorrect || 0), 0) / lecObjs.length;
      if (avgConsecutive >= 2) return "3rd";
      if (avgConsecutive >= 1) return "2nd";
      return "1st";
    } catch {
      return "1st";
    }
  }

  function startTrackerQuestionSession(lec) {
    window.dispatchEvent(
      new CustomEvent("rxt-start-drill", {
        detail: {
          lecId: lec.id,
          lecTitle: lec.lectureTitle,
          mode: "mcq",
          filter: "all",
        },
      })
    );
  }
  const [hasSeenClickHint, setHasSeenClickHint] = useState(() => {
    try {
      return localStorage.getItem("rxt-click-hint-seen") === "1";
    } catch {
      return false;
    }
  });
  const markTodayClickHintSeen = useCallback(() => {
    setHasSeenClickHint(true);
    try {
      localStorage.setItem("rxt-click-hint-seen", "1");
    } catch {}
  }, []);
  useEffect(() => {
    if (!weakConceptFlash) return;
    const t = setTimeout(() => setWeakConceptFlash(null), 4000);
    return () => clearTimeout(t);
  }, [weakConceptFlash]);

  useEffect(() => {
    if (!quickLogOpenId && !quickLogWrongOnlyKey) return;
    function handleOutsideClick(e) {
      if (
        !e.target.closest("[data-quicklog-form]") &&
        !e.target.closest("[data-quicklog-wrong-only]")
      ) {
        setQuickLogOpenId(null);
        setQuickLogWrongOnlyKey(null);
      }
    }
    const id = setTimeout(() => {
      document.addEventListener("click", handleOutsideClick);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [quickLogOpenId, quickLogWrongOnlyKey]);
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const v = localStorage.getItem("rxt-tracker-tab");
      return v || "today";
    } catch {
      return "today";
    }
  });
  useEffect(() => {
    try { localStorage.setItem("rxt-tracker-tab", activeTab || "today"); } catch {}
  }, [activeTab]);
  useEffect(() => {
    if (!sweepMode) return;
    const check = () => {
      const today = new Date().toISOString().slice(0, 10);
      if (sweepModeEnteredDateRef.current && sweepModeEnteredDateRef.current !== today) {
        setSweepMode(false);
        sweepModeEnteredDateRef.current = null;
      }
    };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, [sweepMode]);
  const toggleScheduleDay = (dateStr) => {
    const todayKey = todayKeyForSchedule();
    setExpandedScheduleDays((prev) => ({
      ...prev,
      [dateStr]: !(prev[dateStr] ?? dateStr === todayKey),
    }));
  };
  const toggleScheduleTask = (lecId) => {
    setCollapsedScheduleTasks((prev) => {
      const next = new Set(prev);
      next.has(lecId) ? next.delete(lecId) : next.add(lecId);
      return next;
    });
  };
  const timerRef = useRef(null);
  const { T: t } = useTheme();

  // ── Completion store (localStorage: rxt-completion) ─────────────
  // Key: lectureId__blockId
  const [completion, setCompletion] = useState(() => sGet("rxt-completion") || {});
  useEffect(() => {
    try { sSet("rxt-completion", completion || {}); } catch {}
  }, [completion]);

  // One-time migration: normalize legacy completion entries to activityLog model
  useEffect(() => {
    const raw = sGet("rxt-completion") || {};
    let changed = false;
    const next = { ...(raw || {}) };
    Object.keys(next).forEach((k) => {
      const e = next[k];
      if (!e || typeof e !== "object") return;
      if (Array.isArray(e.activityLog)) return;
      const completed = e.completedDate || e.firstCompletedDate || null;
      const lastAct = e.lastActivityDate || completed || null;
      const conf = e.lastConfidence || e.confidenceRating || null;
      const act = [];
      if (completed) {
        act.push({
          id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : uid(),
          date: completed,
          activityType: "manual",
          confidenceRating: conf || "okay",
          durationMinutes: null,
          note: null,
        });
      }
      next[k] = {
        lectureId: e.lectureId ?? null,
        blockId: e.blockId ?? null,
        ankiInRotation: !!e.ankiInRotation,
        ankiCardCount: e.ankiCardCount ?? null,
        ankiCardsOverdue: e.ankiCardsOverdue ?? null,
        lastAnkiLogDate: e.lastAnkiLogDate ?? null,
        firstCompletedDate: completed,
        lastActivityDate: lastAct,
        lastConfidence: conf,
        reviewDates: Array.isArray(e.reviewDates) ? e.reviewDates : [],
        activityLog: act,
        lectureType: e.lectureType ?? null,
        lectureNumber: e.lectureNumber ?? null,
      };
      changed = true;
    });
    if (changed) setCompletion(next);
  }, []);

  useEffect(() => {
    try {
      const allLecs = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
      if (!Array.isArray(allLecs) || allLecs.length === 0) return;
      const { changed, completionChanged } = cleanOrphanPerfAndCompletion();
      if (completionChanged) {
        try {
          setCompletion(JSON.parse(localStorage.getItem("rxt-completion") || "{}"));
        } catch {}
      }
      if (changed) {
        window.dispatchEvent(new CustomEvent("rxt-objectives-updated"));
      }
    } catch (e) {
      console.warn("cleanOrphanPerfAndCompletion failed:", e);
    }
  }, []);

  const completionKey = (lectureId, blockId) => `${lectureId}__${blockId}`;
  const getCompletion = (lectureId, blockId) =>
    (completion || {})[completionKey(lectureId, blockId)] || null;

  const hasLoggedToday = (lectureId, blockId, todayKey) => {
    const c = getCompletion(lectureId, blockId);
    if (!c?.activityLog || !Array.isArray(c.activityLog)) return false;
    return c.activityLog.some((a) => (a.date || "").slice(0, 10) === todayKey);
  };

  const getTodayActivitySummary = (lectureId, blockId, todayKey) => {
    const c = getCompletion(lectureId, blockId);
    if (!c?.activityLog || !Array.isArray(c.activityLog)) return null;
    const todayActs = c.activityLog.filter((a) => (a.date || "").slice(0, 10) === todayKey);
    if (todayActs.length === 0) return null;
    return { activityType: todayActs[0].activityType, confidenceRating: todayActs[0].confidenceRating };
  };

  // UI drafts for "✓ Completed today" inline controls (per lecture)
  const [completionDrafts, setCompletionDrafts] = useState(() => ({}));

  const isControlled = trackerRowsProp !== undefined && setTrackerRowsProp != null;
  const rows = isControlled ? trackerRowsProp : internalRows;
  const setRows = isControlled ? setTrackerRowsProp : setInternalRows;

  const refreshAllData = useCallback(() => {
    try {
      setPerfData(JSON.parse(localStorage.getItem("rxt-performance") || "{}"));
    } catch {
      setPerfData({});
    }
    try {
      const raw = localStorage.getItem("rxt-completion");
      const c = raw ? JSON.parse(raw) : {};
      setCompletionData(c);
      setCompletion(c);
    } catch {
      setCompletionData({});
      setCompletion({});
    }
    try {
      const rowsJson = JSON.parse(localStorage.getItem("rxt-tracker-v2") || "[]");
      if (isControlled && setTrackerRowsProp) setTrackerRowsProp(rowsJson);
      else if (!isControlled) setInternalRows(rowsJson);
    } catch {}
    setRefreshKey((k) => k + 1);
  }, [isControlled, setTrackerRowsProp]);

  const studyCoachForToday = useCallback(
    (lec, bid) =>
      computeStudyCoachSteps(lec, bid, perfData, { ...completionData, ...(completion || {}) }, getBlockObjectives),
    [perfData, completionData, completion, getBlockObjectives]
  );

  const makeKey = useMemo(
    () => makeTopicKey || ((lectureId, blockId) => (lectureId ? `${lectureId}__${blockId}` : `block__${blockId}`)),
    [makeTopicKey]
  );
  const getLecPerf = useCallback(
    (lec, blockId) => {
      const key = makeKey(lec.id, blockId);
      if (performanceHistory[key]) return performanceHistory[key];
      const fallbackKey = Object.keys(performanceHistory || {}).find((k) => k.startsWith(lec.id + "__"));
      if (fallbackKey) return performanceHistory[fallbackKey];
      return null;
    },
    [performanceHistory, makeKey]
  );

  const targetBlockIds = useMemo(() => {
    if (trackerBlockId) return [trackerBlockId];
    return Object.values(blocks || {}).map((b) => b?.id).filter(Boolean);
  }, [trackerBlockId, blocks]);

  const isCriticalFor = useCallback(
    (lec, bid) => {
      const perf = getLecPerf(lec, bid);
      const entry = (completion || {})[`${lec?.id}__${bid}`];
      return isCriticalLectureFromData(lec, bid, perf, entry, getBlockObjectives);
    },
    [completion, getLecPerf, getBlockObjectives]
  );
  const isOverdueFor = useCallback(
    (lec, bid) => {
      const perf = getLecPerf(lec, bid);
      const nr = perf?.nextReview ? new Date(perf.nextReview) : null;
      return !!(nr && !isNaN(nr.getTime()) && nr < startOfStudyDay());
    },
    [getLecPerf]
  );
  const isSoonFor = useCallback(
    (lec, bid) => {
      const perf = getLecPerf(lec, bid);
      const entry = (completion || {})[`${lec?.id}__${bid}`];
      return isSoonLectureFromData(lec, bid, perf, entry, getBlockObjectives);
    },
    [completion, getLecPerf, getBlockObjectives]
  );
  const isOkFor = useCallback(
    (lec, bid) => {
      const perf = getLecPerf(lec, bid);
      const entry = (completion || {})[`${lec?.id}__${bid}`];
      return isOkLectureFromData(lec, bid, perf, entry, getBlockObjectives);
    },
    [completion, getLecPerf, getBlockObjectives]
  );

  const trackerSummary = useMemo(() => {
    const st = startOfStudyDay();
    const completions = completion || {};
    const todayIso = studyDayKeyNow();

    const perBlockOverdue = {};
    let totalLectures = 0;
    let critical = 0;
    let overdue = 0;
    let done = 0;
    let tracked = 0;
    let soon = 0;
    let ok = 0;

    const allBlockIds = Object.values(blocks || {})
      .map((b) => b?.id)
      .filter(Boolean);

    allBlockIds.forEach((bid) => {
      const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
      let blockOd = 0;
      blockLecs.forEach((lec) => {
        const perf = getLecPerf(lec, bid);
        const nr = perf?.nextReview ? new Date(perf.nextReview) : null;
        if (nr && !isNaN(nr.getTime()) && nr < st) blockOd++;
      });
      perBlockOverdue[bid] = blockOd;
    });

    targetBlockIds.forEach((bid) => {
      if (!bid) return;
      const objsForBlock = typeof getBlockObjectives === "function" ? getBlockObjectives(bid) : [];
      const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
      totalLectures += blockLecs.length;

      blockLecs.forEach((lec) => {
        const key = `${lec.id}__${bid}`;
        const entry = completions[key];
        const perf = getLecPerf(lec, bid);

        const lecObjs = objsForBlock.filter(
          (o) =>
            String(o.lectureNumber) === String(lec.lectureNumber) ||
            o.linkedLecId === lec.id
        );
        const isCritical = isCriticalLectureFromData(lec, bid, perf, entry, getBlockObjectives);

        const nr = perf?.nextReview ? new Date(perf.nextReview) : null;
        const isOverdue = !!(nr && !isNaN(nr.getTime()) && nr < st);

        const allMastered = lecObjs.length > 0 && lecObjs.every((o) => o.status === "mastered");
        const loggedToday = entry?.activityLog?.some((a) => String(a?.date || "").slice(0, 10) === todayIso);
        const isDone = allMastered || !!loggedToday;

        const raw = perf?.sessions || [];
        const sess = raw.filter((s) => !s.lectureId || s.lectureId === lec.id);
        if (sess.length > 0) tracked++;

        if (isSoonLectureFromData(lec, bid, perf, entry, getBlockObjectives)) soon++;
        if (isOkLectureFromData(lec, bid, perf, entry, getBlockObjectives)) ok++;

        if (isCritical) critical++;
        if (isOverdue) overdue++;
        if (isDone) done++;
      });
    });

    const scopedRows = (rows || []).filter((r) => {
      if (r.blockId && targetBlockIds.includes(r.blockId)) return true;
      const bid = Object.values(blocks || {}).find((b) => b.name === r.block)?.id;
      return bid && targetBlockIds.includes(bid);
    });
    const total = scopedRows.length;
    const onSchedule = Math.max(0, totalLectures - critical - overdue);

    return {
      total,
      critical,
      overdue,
      done,
      onSchedule,
      tracked,
      totalLectures,
      soon,
      ok,
      perBlockOverdue,
    };
  }, [
    rows,
    blocks,
    lecs,
    completion,
    getBlockObjectives,
    targetBlockIds,
    getLecPerf,
  ]);

  const mergedTodayItems = useMemo(() => {
    const todayISO = studyDayKeyNow();
    const st = startOfStudyDay();
    const allItems = [];
    targetBlockIds.forEach((bid) => {
      if (!bid) return;
      const examDate = examDates[bid] || "";
      const result = examDate && generateDailySchedule ? generateDailySchedule(bid, examDate) : null;
      const todayDay = (result?.schedule || []).find((d) => d?.dateStr === todayISO) || null;
      const todayTasks = Array.isArray(todayDay?.tasks) ? todayDay.tasks : [];
      const normalizedTasks = todayTasks.map((t0) => ({
        ...t0,
        _matchReason: t0.matchReason === "scheduled-day" ? "TODAY'S LECTURE" : (t0.matchReason || ""),
      }));
      const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
      const overdueItems = blockLecs
        .map((lec) => {
          const perf = getLecPerf(lec, bid);
          const nr = perf?.nextReview ? new Date(perf.nextReview) : null;
          if (!nr || isNaN(nr.getTime()) || nr >= st) return null;
          const daysOverdue = Math.max(1, Math.ceil((st.getTime() - nr.getTime()) / 86400000));
          return {
            lec,
            blockId: bid,
            matchReason: "⏰ OVERDUE",
            isOverdue: true,
            urgency: 999,
            daysOverdue,
          };
        })
        .filter(Boolean);
      const taskItems = normalizedTasks
        .filter((t0) => t0?.lec?.id)
        .map((t0) => ({
          ...t0,
          blockId: bid,
          lec: t0.lec,
          matchReason: t0._matchReason || t0.matchReason || "",
          isOverdue: t0.isOverdue === true || String(t0._matchReason || t0.matchReason || "").toUpperCase().includes("OVERDUE"),
        }));
      const map = new Map();
      [...overdueItems, ...taskItems].forEach((item) => {
        const key = `${item.lec.id}__${bid}`;
        if (!map.has(key)) map.set(key, item);
      });
      allItems.push(...Array.from(map.values()));
    });
    return allItems;
  }, [targetBlockIds, examDates, generateDailySchedule, lecs, getLecPerf]);

  // Load (when uncontrolled)
  useEffect(() => {
    if (isControlled) {
      setReady(true);
      return;
    }
    const saved = sGet("rxt-tracker-v2");
    const loaded = saved || SAMPLE;
    const deduped = deduplicateTrackerRows(loaded);
    if (deduped.length !== loaded.length) {
      setInternalRows(deduped);
      try {
        sSet("rxt-tracker-v2", deduped);
      } catch {}
    } else {
      setInternalRows(loaded);
    }
    setReady(true);
  }, [isControlled]);

  // When navigating to Tracker from a block, select that block's tab
  useEffect(() => {
    if (activeBlock?.id) {
      setTrackerBlockId(activeBlock.id);
      if (activeBlock?.name) setFilter(activeBlock.name);
    }
  }, [activeBlock?.id, activeBlock?.name]);

  useEffect(() => {
    const handler = () => setTimeout(refreshAllData, 0);
    window.addEventListener("rxt-tracker-refresh", handler);
    window.addEventListener("rxt-completion-updated", handler);
    window.addEventListener("rxt-objectives-updated", handler);
    window.addEventListener("rxt-start-drill", handler);
    return () => {
      window.removeEventListener("rxt-tracker-refresh", handler);
      window.removeEventListener("rxt-completion-updated", handler);
      window.removeEventListener("rxt-objectives-updated", handler);
      window.removeEventListener("rxt-start-drill", handler);
    };
  }, [refreshAllData]);

  useEffect(() => {
    setTodayFilter("all");
    setTodaySort("urgency");
    setTodaySearch("");
    setShowNotStarted(false);
  }, [trackerBlockId]);

  // Save (debounced when uncontrolled; parent persists when controlled)
  const persist = (nr) => {
    clearTimeout(timerRef.current);
    if (isControlled) {
      // Parent's setTrackerRows updater runs synchronously and calls persist(); never call
      // Tracker setState inside that stack or React warns (update Tracker while rendering App).
      queueMicrotask(() => {
        setSaveMsg("saved");
        setTimeout(() => setSaveMsg(""), 2000);
      });
      return;
    }
    setSaveMsg("saving");
    timerRef.current = setTimeout(() => { sSet("rxt-tracker-v2", nr); setSaveMsg("saved"); setTimeout(() => setSaveMsg(""), 2000); }, 500);
  };

  const todayStr = () => studyDayKeyNow();
  const addRow   = row        => setRows(p=>{ const n=[...p,row]; persist(n); return n; });

  const mapActivityIcon = (t) =>
    t === "deep_learn" ? "🧠"
      : t === "review" ? "📖"
        : t === "anki" ? "🃏"
          : t === "questions" ? "❓"
            : t === "notes" ? "📝"
              : t === "sg_tbl" ? "👥"
                : "✏️";

  function updateAnkiCounts(lectureId, blockId, cardCount, overdueCount) {
    const key = completionKey(lectureId, blockId);
    setCompletion((prev) => {
      const ex = (prev || {})[key];
      if (!ex) return prev;
      const nextCardCount = cardCount != null ? cardCount : (ex.ankiCardCount ?? null);
      const nextOverdue = overdueCount != null ? overdueCount : (ex.ankiCardsOverdue ?? null);
      return {
        ...(prev || {}),
        [key]: {
          ...ex,
          ankiCardCount: nextCardCount,
          ankiCardsOverdue: nextOverdue,
          lastAnkiLogDate: new Date().toISOString(),
        },
      };
    });
  }

  function logActivity(lectureId, blockId, activityType, confidenceRating, options = {}) {
    if (!lectureId || !blockId) return;
    const activityDate = options?.date
      ? new Date(options.date).toISOString()
      : new Date().toISOString();
    const dateKey = activityDate.slice(0, 10);
    const durationMinutes = options?.durationMinutes ?? null;
    const note = options?.note ?? null;
    const examDateStr = options?.examDate || null;
    const questionCount = options?.questionCount ?? null;
    const correctCount = options?.correctCount ?? null;
    const questionScore = options?.questionScore ?? null;

    const key = completionKey(lectureId, blockId);
    const lec = (lecs || []).find((l) => l.id === lectureId);

    setCompletion((prev) => {
      const existing = (prev || {})[key] || null;
      const activity = {
        id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : uid(),
        date: activityDate,
        activityType: activityType || "manual",
        confidenceRating: confidenceRating || "okay",
        durationMinutes,
        note,
        questionCount: questionCount ?? null,
        correctCount: correctCount ?? null,
        questionScore: questionScore ?? null,
      };
      const unsorted = [activity, ...(Array.isArray(existing?.activityLog) ? existing.activityLog : [])];
      const activityLog = [...unsorted].sort((a, b) => new Date(b?.date || 0) - new Date(a?.date || 0)); // newest first
      const firstCompletedDate = existing?.firstCompletedDate || activityDate;
      const lastActivityDate = activityLog[0]?.date || activityDate;
      const lastConfidence = activityLog[0]?.confidenceRating || activity.confidenceRating;
      const reviewDates = computeReviewDates(lastActivityDate.slice(0, 10), lastConfidence, examDateStr || null).map((d) => d.toISOString().slice(0, 10));

      const next = {
        ...(prev || {}),
        [key]: {
          lectureId,
          blockId,
          ankiInRotation: activity.activityType === "anki" ? true : !!existing?.ankiInRotation,
          ankiCardCount: existing?.ankiCardCount ?? null,
          ankiCardsOverdue: existing?.ankiCardsOverdue ?? null,
          lastAnkiLogDate: existing?.lastAnkiLogDate ?? null,
          firstCompletedDate,
          lastActivityDate,
          lastConfidence,
          reviewDates,
          activityLog,
          lectureType: lec?.lectureType ?? existing?.lectureType ?? null,
          lectureNumber: lec?.lectureNumber ?? existing?.lectureNumber ?? null,
          sessionCount: (existing?.sessionCount ?? 0) + 1,
        },
      };
      // Keep localStorage in sync immediately; Tracker coach UI uses perfData/completionData refreshed via refreshAllData / refreshKey.
      sSet("rxt-completion", next);
      return next;
    });

    // Keep the tracker log rows in sync (best-effort in Tracker)
    const blockName = Object.values(blocks || {}).find((b) => b.id === blockId)?.name || blockId;
    const canonicalTitle = getTrackerLectureTitle(lectureId, lec);
    const topic = canonicalTitle || "Lecture";

    setRows((p) => {
      const idx = (p || []).findIndex((r) => r.lectureId === lectureId);
      if (idx >= 0) {
        const cur = (p || [])[idx];
        const rowTopic = canonicalTitle || String(cur?.topic || topic || "Lecture").trim();
        const n = (p || []).map((r, i) =>
          i === idx
            ? {
                ...r,
                lectureId,
                blockId,
                block: r.block || blockName,
                subject: lec?.subject || lec?.discipline || r.subject || "",
                topic: rowTopic,
                lecture: true,
                lastStudied: dateKey,
              }
            : r
        );
        persist(n);
        return n;
      }
      const row = makeRow({
        id: uid(),
        lectureId,
        blockId,
        block: blockName,
        subject: lec?.subject || lec?.discipline || "",
        topic,
        lecture: true,
        lastStudied: dateKey,
      });
      const n = [...(p || []), row];
      persist(n);
      return n;
    });

    try {
      const raw = localStorage.getItem("rxt-weak-areas");
      const data = raw ? JSON.parse(raw) : null;
      if (data && data.blockId === blockId) {
        localStorage.setItem("rxt-weak-areas", JSON.stringify({ ...data, computedAt: 0 }));
      }
    } catch {}
  }

  // Backward-compatible wrapper used by existing UI paths
  const markLectureComplete = (lectureId, blockId, completedDate, confidenceRating, ankiInRotation, examDateStr) => {
    logActivity(lectureId, blockId, "manual", confidenceRating, { date: completedDate || todayStr(), examDate: examDateStr, note: null, durationMinutes: null });
    // Persist entry-level ankiInRotation toggle
    if (ankiInRotation) {
      const key = completionKey(lectureId, blockId);
      setCompletion((prev) => {
        const ex = (prev || {})[key];
        if (!ex) return prev;
        return { ...(prev || {}), [key]: { ...ex, ankiInRotation: true } };
      });
    }
  };

  /** Writes rxt-completion via logActivity using key `${lectureId}__${blockId}` only — never resolves lectureId from title. */
  const markLectureReviewedToday = (
    lectureId,
    blockId,
    confidenceRating = "okay",
    examDateStr = null,
    activityType = "review",
    sessionDateInput = null
  ) => {
    if (!lectureId || !blockId) return;
    const logDate =
      sessionDateInput != null && String(sessionDateInput).trim() !== ""
        ? new Date(sessionDateInput).toISOString().slice(0, 10)
        : todayStr();
    logActivity(lectureId, blockId, activityType || "review", confidenceRating, { date: logDate, examDate: examDateStr });
  };

  const logReview = (lectureId, blockId, reviewDate, newConfidenceRating, examDateStr) => {
    logActivity(lectureId, blockId, "review", newConfidenceRating, { date: reviewDate || todayStr(), examDate: examDateStr });
  };

  // Filter
  let visible = rows.filter(r => {
    if (filter!=="All" && r.block!==filter) return false;
    if (urgFilter!=="All" && getUrgency(r.confidence,r.lastStudied)!==urgFilter) return false;
    if (search) { const q=search.toLowerCase(); if(!(r.subject||"").toLowerCase().includes(q)&&!(r.topic||"").toLowerCase().includes(q)) return false; }
    return true;
  });

  // Sort
  const ORD = { critical:0, overdue:1, soon:2, ok:3, none:4 };
  if (sortBy==="urgency")    visible=[...visible].sort((a,b)=>ORD[getUrgency(a.confidence,a.lastStudied)]-ORD[getUrgency(b.confidence,b.lastStudied)]);
  if (sortBy==="confidence") visible=[...visible].sort((a,b)=>(a.confidence||99)-(b.confidence||99));
  if (sortBy==="score")      visible=[...visible].sort((a,b)=>(avg(a.scores)??101)-(avg(b.scores)??101));

  // Group for block view
  const grouped = {};
  if (sortBy==="block") {
    visible.forEach(r=>{
      if(!grouped[r.block]) grouped[r.block]={};
      if(!grouped[r.block][r.subject]) grouped[r.block][r.subject]=[];
      grouped[r.block][r.subject].push(r);
    });
  }

  const notStartedCount = useMemo(() => {
    return targetBlockIds.reduce((n, bid) => {
      const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
      return (
        n +
        blockLecs.filter((lec) => {
          const p = getLecPerf(lec, bid);
          const raw = p?.sessions || [];
          const sess = raw.filter((s) => !s.lectureId || s.lectureId === lec.id);
          const hasCompletion = !!(completion || {})[`${lec.id}__${bid}`];
          return sess.length === 0 && !hasCompletion;
        }).length
      );
    }, 0);
  }, [targetBlockIds, lecs, completion, getLecPerf]);

  const filterCounts = useMemo(
    () => {
      const bids = targetBlockIds;
      const blockLecs = (lecs || []).filter((l) => bids.includes(l.blockId));
      const all = blockLecs.length;
      const critical = blockLecs.filter((lec) => isCriticalFor(lec, lec.blockId)).length;
      const overdue = blockLecs.filter((lec) => isOverdueFor(lec, lec.blockId)).length;
      const soon = blockLecs.filter((lec) => isSoonFor(lec, lec.blockId)).length;
      const ok = blockLecs.filter((lec) => isOkFor(lec, lec.blockId)).length;
      return { all, critical, overdue, soon, ok };
    },
    [targetBlockIds, lecs, isCriticalFor, isOverdueFor, isSoonFor, isOkFor]
  );

  if (!ready) return (
    <div style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:60 }}>
      <div style={{ width:36,height:36,border:"3px solid "+t.border1,borderTopColor:t.statusBad,borderRadius:"50%",animation:"rxt-spin 0.85s linear infinite" }}/>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, fontFamily:MONO, background:t.appBg, color:t.text1 }}>

      {/* Compact PressureBanner (driven by trackerBlockId) */}
      {(() => {
        if (!trackerBlockId) {
          return (
            <div style={{ padding: "12px 18px", borderBottom: "1px solid " + t.border2, background: t.subnavBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontFamily: MONO, fontSize: 12, color: t.text3 }}>All blocks</div>
            </div>
          );
        }
        const bid = trackerBlockId;
        const examDate = (examDates && examDates[bid]) || "";
        const p = examDate ? getPressureZone(examDate) : { zone: "normal", days: 0, label: "Set exam date" };
        const zoneColor =
          p.zone === "critical" || p.zone === "exam"
            ? t.statusBad
            : p.zone === "crunch"
              ? t.statusWarn
              : p.zone === "build"
                ? t.statusProgress
                : t.statusGood;
        const desc =
          p.zone === "normal"
            ? "Standard spacing active."
            : p.zone === "build"
              ? "Intervals tightening."
              : p.zone === "crunch"
                ? "Exam week mode."
                : p.zone === "critical"
                  ? "Final push."
                  : "Exam day.";
        const overdueCount = trackerSummary.overdue;
        const trackedCount = trackerSummary.tracked;
        const totalLec = trackerSummary.totalLectures;
        return (
          <div style={{ padding: "10px 18px", borderBottom: "1px solid " + t.border2, background: t.subnavBg, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: 1, minWidth: 240 }}>
              <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 900, color: zoneColor }}>
                {p.days > 0 ? p.days : "—"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 900, color: zoneColor }}>
                  {p.label || "Pressure"}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>
                  {examDate ? desc : "Set an exam date to activate pressure zones."}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
              <div style={{ fontFamily: MONO, fontSize: 11, color: overdueCount > 0 ? t.statusBad : t.text3, fontWeight: 800 }}>
                {overdueCount} overdue
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, fontWeight: 800 }}>
                {trackedCount}/{totalLec} tracked
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div style={{ padding:"10px 18px", borderBottom:"1px solid "+t.border2, background:t.subnavBg,
        display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", flexShrink:0 }}>

        {/* New tabs (Today / Lectures / Calendar) */}
        <div style={{ display: "flex", gap: 2 }}>
          {[
            ["today", "Today"],
            ["lectures", "Lectures"],
            ["calendar", "Calendar"],
            [
              "weakConcepts",
              weakConceptsBadgeCount > 0
                ? `Weak Concepts (${weakConceptsBadgeCount})`
                : "Weak Concepts",
            ],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setActiveTab(v)}
              style={{
                background: activeTab === v ? t.cardBg : "transparent",
                border: "1px solid " + (activeTab === v ? t.border2 : "transparent"),
                borderBottom: activeTab === v ? "none" : "1px solid transparent",
                color: activeTab === v ? t.text1 : t.text3,
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 13,
                fontWeight: 900,
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {tab==="tracker" && activeTab !== "weakConcepts" && <>
          {/* Block filters */}
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {[
              { key: "all", name: "All", id: null },
              ...Object.values(blocks || {}).filter(b => b?.name).map(b => ({ key: b.id, name: b.name })),
            ].map(({ key: tabKey, name, id }) => {
              const block = id === null ? null : (Object.values(blocks || {}).find((b) => b.id === tabKey || b.name === name));
              const bid = block?.id ?? null;
              const isSelected = trackerBlockId === bid;
              const examDate = bid ? (examDates?.[bid] || "") : "";
              const pressure = bid && examDate ? getPressureZone(examDate) : null;
              const overdueCount = bid ? (trackerSummary.perBlockOverdue[bid] ?? 0) : 0;
              const activeColor = overdueCount > 0 ? (t.statusBad || "#E24B4A") : (pressure?.zone === "crunch" || pressure?.zone === "critical" || pressure?.zone === "exam") ? (t.statusWarn || "#BA7517") : (t.statusGood || "#639922");
              return (
                <button
                  key={tabKey}
                  onClick={() => {
                    setTrackerBlockId(bid);
                    setFilter(name);
                  }}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 20,
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 500,
                    border: (isSelected ? "2px solid " : "0.5px solid ") + (isSelected ? activeColor : t.border2),
                    background: isSelected ? activeColor + "18" : "transparent",
                    color: isSelected ? activeColor : t.text3,
                    transition: "all 0.15s ease",
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>

          {/* Urgency filter */}
          <div style={{ display:"flex", gap:3 }}>
            {[
              ["all", `All (${filterCounts.all})`, { bg: t.inputBg, fg: t.text1, border: t.border1 }, filterCounts.all],
              ["critical", `△ Critical (${filterCounts.critical})`, { bg: "#FCEBEB", fg: "#A32D2D", border: "#F09595" }, filterCounts.critical],
              ["overdue", `⏰ Overdue (${filterCounts.overdue})`, { bg: "#FAEEDA", fg: "#633806", border: "#EF9F27" }, filterCounts.overdue],
              ["soon", `⊙ Soon (${filterCounts.soon})`, { bg: "#E6F1FB", fg: "#0C447C", border: "#85B7EB" }, filterCounts.soon],
              ["ok", `✓ OK (${filterCounts.ok})`, { bg: "#EAF3DE", fg: "#27500A", border: "#97C459" }, filterCounts.ok],
            ].map(([v, l, c, count]) => (
              <button key={v} onClick={() => setTodayFilter(v)} style={{
                background: todayFilter === v ? c.bg : "transparent",
                border: "0.5px solid " + (todayFilter === v ? c.border : t.border2),
                color: todayFilter === v ? c.fg : t.text2,
                padding: "3px 9px",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 13,
                opacity: count === 0 ? 0.5 : 1,
                transition: "all 0.15s ease",
              }}>{l}</button>
            ))}
          </div>

          {/* Sort */}
          <select value={todaySort} onChange={e=>setTodaySort(e.target.value)} style={{ background:t.cardBg,border:"1px solid "+t.border1,color:t.text5,padding:"4px 10px",borderRadius:7,fontFamily:MONO,fontSize:13,outline:"none",cursor:"pointer" }}>
            {[
              ["urgency","Sort: Urgency"],
              ["score","Sort: Score ↑ (weakest first)"],
              ["score_desc","Sort: Score ↓ (strongest first)"],
              ["recent","Sort: Recent activity"],
              ["name","Sort: Name A-Z"],
              ["bloom","Sort: Complexity"],
            ].map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>

          {/* Search */}
          <div style={{ display:"flex",alignItems:"center",gap:5,background:t.cardBg,border:"1px solid "+t.border1,borderRadius:7,padding:"4px 9px" }}>
            <span style={{ color:t.text4,fontSize:13 }}>🔍</span>
            <input value={todaySearch} onChange={e=>setTodaySearch(e.target.value)} placeholder="Search…"
              style={{ background:"none",border:"none",color:t.text1,fontFamily:MONO,fontSize:13,outline:"none",width:120 }} />
            {todaySearch&&<button onClick={()=>setTodaySearch("")} style={{ background:"none",border:"none",color:t.text4,cursor:"pointer",fontSize:13 }}>✕</button>}
          </div>

          {/* Show not started toggle */}
          <button
            onClick={() => setShowNotStarted(p => !p)}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid " + (showNotStarted ? t.border1 : t.border2),
              background: showNotStarted ? t.inputBg : t.cardBg,
              color: t.text3,
              cursor: "pointer",
            }}
          >
            {showNotStarted
              ? "○ Hide not started"
              : `○ Show all (${notStartedCount} not started)`}
          </button>
        </>}

        {/* Right side */}
        {activeTab !== "weakConcepts" && (
          <div style={{ marginLeft:"auto", display:"flex", gap:7, alignItems:"center" }}>
            {trackerSummary.critical>0 && <div style={{ background:t.statusBadBg,border:"1px solid "+t.statusBad,borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:16 }}>⚠</span><span style={{ fontFamily:MONO,color:t.statusBad,fontSize:13,fontWeight:700 }}>{trackerSummary.critical} critical</span></div>}
            {trackerSummary.overdue>0  && <div style={{ background:t.statusBadBg,border:"1px solid "+t.statusBad,borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:16 }}>⏰</span><span style={{ fontFamily:MONO,color:t.statusBad,fontSize:13,fontWeight:700 }}>{trackerSummary.overdue} overdue</span></div>}
            {[["Rows",trackerSummary.total],["Done",trackerSummary.done]].map(([l,v])=>(
              <div key={l} style={{ background:t.cardBg,borderRadius:6,padding:"3px 10px",display:"flex",gap:5,alignItems:"center", border:"1px solid "+t.border1 }}>
                <span style={{ color:t.text4,fontSize:13 }}>{l}</span>
                <span style={{ color:t.text1,fontSize:13,fontWeight:600 }}>{v}</span>
              </div>
            ))}
            <button onClick={()=>setShowAdd(true)} style={{ background:t.statusBad,border:"none",color:t.text1,padding:"6px 14px",borderRadius:7,cursor:"pointer",fontFamily:MONO,fontSize:13,fontWeight:700 }}>+ Add Row</button>
            {saveMsg&&<span style={{ fontSize:13,color:saveMsg==="saved"?t.statusGood:t.statusWarn }}>{saveMsg==="saving"?"⟳ Saving…":"✓ Saved"}</span>}
          </div>
        )}
      </div>

      {/* ── TRACKER TABLE ──────────────────────────────── */}
      {tab==="tracker" && (
        <div style={{ flex: 1, overflowX: "hidden", overflowY: "auto", width: "100%" }}>
          <div style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>

            {/* Lectures tab — grouped by week + type, filter bar, expandable rows */}
            {activeTab === "lectures" && (() => {
              const lecturesBid = trackerBlockId || activeBlock?.id;
              if (!lecturesBid) return null;
              return (
                <LecturesTabContent
                  blockId={lecturesBid}
                  examDate={examDates[lecturesBid] || ""}
                  todayISO={todayStr()}
                  completion={completion}
                  setCompletion={setCompletion}
                  lecs={lecs}
                  completionKey={completionKey}
                  getCompletion={getCompletion}
                  markLectureComplete={markLectureComplete}
                  logActivity={logActivity}
                  updateAnkiCounts={updateAnkiCounts}
                  logReview={logReview}
                  computeReviewDates={computeReviewDates}
                  getLectureActivitySummary={getLectureActivitySummary}
                  getConfidenceTrend={getConfidenceTrend}
                  theme={t}
                  MONO={MONO}
                />
              );
            })()}

            {/* Today tab (Step B): Overdue / Today's lectures / Reviews due */}
            {activeTab === "today" && (() => {
              const bids = targetBlockIds;
              if (!bids.length) return null;
              const completions = completion || {};
              const studyDayKey = studyDayKeyNow();
              const todayKey = studyDayKey;
              const todayCalendarStr = new Date().toDateString();
              const dow = startOfStudyDay().toLocaleDateString("en-US", { weekday: "short" });
              const isScheduledToday = (lec) => {
                if (!lec) return false;
                if (lec.lectureDate && String(lec.lectureDate).slice(0, 10) === todayKey) return true;
                if (lec.weekNumber && lec.dayOfWeek) {
                  return String(lec.dayOfWeek).slice(0, 3).toLowerCase() === String(dow).slice(0, 3).toLowerCase();
                }
                return false;
              };
              const loggedToday = (lecId, blockId) => {
                const entry = completions[`${lecId}__${blockId}`];
                if (!entry || !entry.activityLog) return false;
                return entry.activityLog.some((a) => String(a?.date || "").startsWith(studyDayKey));
              };

              const allItemsBase = mergedTodayItems;
              const withNotStarted = (() => {
                if (!showNotStarted) return allItemsBase;
                const next = [...allItemsBase];
                bids.forEach((bid) => {
                  const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
                  blockLecs.forEach((lec) => {
                    // Include all lecture types (DLA/LEC/SG/TBL/LAB/CLIN) when scheduled today
                    if (isScheduledToday(lec)) {
                      const key = `${lec.id}__${bid}`;
                      if (!next.some((i) => `${i.lec?.id}__${i.blockId}` === key)) {
                        next.push({
                          lec,
                          blockId: bid,
                          matchReason: "TODAY'S LECTURE",
                          _matchReason: "TODAY'S LECTURE",
                          isNotStarted: false,
                          urgency: 0,
                        });
                      }
                    }
                    const p = getLecPerf(lec, bid);
                    const raw = p?.sessions || [];
                    const sess = raw.filter((s) => !s.lectureId || s.lectureId === lec.id);
                    const hasCompletion = !!completions[`${lec.id}__${bid}`];
                    if (sess.length === 0 && !hasCompletion) {
                      const key = `${lec.id}__${bid}`;
                      if (!next.some((i) => `${i.lec?.id}__${i.blockId}` === key)) {
                        next.push({
                          lec,
                          blockId: bid,
                          matchReason: "○ NOT STARTED",
                          _matchReason: "○ NOT STARTED",
                          isNotStarted: true,
                          urgency: -999,
                        });
                      }
                    }
                  });
                });
                return next;
              })();

              const withNotStartedUrgency = (() => {
                if (todayFilter !== "critical" && todayFilter !== "soon" && todayFilter !== "ok") return withNotStarted;
                const scopeBids = trackerBlockId != null ? [trackerBlockId] : bids;
                const map = new Map();
                withNotStarted.forEach((it) => {
                  if (it?.lec?.id != null) map.set(`${it.lec.id}__${it.blockId}`, it);
                });
                scopeBids.forEach((bid) => {
                  if (!bid) return;
                  const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
                  blockLecs.forEach((lec) => {
                    const key = `${lec.id}__${bid}`;
                    if (map.has(key)) return;
                    let match = false;
                    if (todayFilter === "critical") match = isCriticalFor(lec, bid);
                    else if (todayFilter === "soon") match = isSoonFor(lec, bid);
                    else if (todayFilter === "ok") match = isOkFor(lec, bid);
                    if (!match) return;
                    const label =
                      todayFilter === "critical"
                        ? "△ CRITICAL"
                        : todayFilter === "soon"
                          ? "⊙ SOON"
                          : "✓ OK";
                    map.set(key, {
                      lec,
                      blockId: bid,
                      matchReason: label,
                      _matchReason: label,
                      urgency: 0,
                      fromUrgencySynthetic: true,
                    });
                  });
                });
                return Array.from(map.values());
              })();

              const applyTodayFilter = (items, f) => {
                const scoped =
                  trackerBlockId != null ? (items || []).filter((it) => it?.blockId === trackerBlockId) : (items || []);
                if (f === "all") return scoped;
                return scoped.filter((item) => {
                  switch (f) {
                    case "critical":
                      return isCriticalFor(item.lec, item.blockId);
                    case "overdue":
                      return isOverdueFor(item.lec, item.blockId);
                    case "soon":
                      return isSoonFor(item.lec, item.blockId);
                    case "ok":
                      return isOkFor(item.lec, item.blockId);
                    default:
                      return true;
                  }
                });
              };

              const applyTodaySort = (items, srt) => {
                const sorted = [...items];
                sorted.sort((a, b) => {
                  if (a.isNotStarted && !b.isNotStarted) return 1;
                  if (b.isNotStarted && !a.isNotStarted) return -1;
                  switch (srt) {
                    case "score": {
                      const as = getLecPerf(a.lec, a.blockId)?.score || 0;
                      const bs = getLecPerf(b.lec, b.blockId)?.score || 0;
                      return as - bs;
                    }
                    case "score_desc": {
                      const as = getLecPerf(a.lec, a.blockId)?.score || 0;
                      const bs = getLecPerf(b.lec, b.blockId)?.score || 0;
                      return bs - as;
                    }
                    case "recent": {
                      const ak = `${a.lec.id}__${a.blockId}`;
                      const bk = `${b.lec.id}__${b.blockId}`;
                      const ad = completions[ak]?.lastActivityDate || "0";
                      const bd = completions[bk]?.lastActivityDate || "0";
                      return String(bd).localeCompare(String(ad));
                    }
                    case "name":
                      return String(a.lec.lectureTitle || a.lec.title || "").localeCompare(String(b.lec.lectureTitle || b.lec.title || ""));
                    case "bloom": {
                      const aObjs = (getBlockObjectives?.(a.blockId) || []).filter((o) => o.linkedLecId === a.lec.id);
                      const bObjs = (getBlockObjectives?.(b.blockId) || []).filter((o) => o.linkedLecId === b.lec.id);
                      const abloom = aObjs.reduce((m, o) => Math.max(m, o?.bloom_level || 1), 1);
                      const bbloom = bObjs.reduce((m, o) => Math.max(m, o?.bloom_level || 1), 1);
                      return bbloom - abloom;
                    }
                    default:
                      return (b.urgency || 0) - (a.urgency || 0);
                  }
                });
                return sorted;
              };

              const searchedItems = (() => {
                const filtered = applyTodayFilter(withNotStartedUrgency, todayFilter);
                const sorted = applyTodaySort(filtered, todaySort);
                const q = todaySearch.toLowerCase().trim();
                if (!q) return sorted;
                return sorted.filter((item) => {
                  const title = String(item.lec?.lectureTitle || item.lec?.title || "").toLowerCase();
                  const ltype = String(item.lec?.lectureType || "").toLowerCase();
                  const lnum = String(item.lec?.lectureNumber ?? "");
                  return title.includes(q) || ltype.includes(q) || lnum.includes(q);
                });
              })();

              const overdueList = searchedItems.filter((it) => it.isOverdue || String(it.matchReason || "").toUpperCase().includes("OVERDUE"));
              const todayLectures = searchedItems.filter((it) => {
                if (overdueList.includes(it)) return false;
                if (String(it._matchReason || it.matchReason || "") !== "TODAY'S LECTURE") return false;
                const comp = completionData[`${it.lec.id}__${it.blockId}`];
                if (comp?.lastActivityDate) {
                  const lastDate = new Date(comp.lastActivityDate).toDateString();
                  if (lastDate === todayCalendarStr) return false;
                }
                return true;
              });

              const sectionLabelStyle = {
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 500,
                color: t.text3,
                letterSpacing: "0.06em",
                marginBottom: 6,
              };
              const renderDonePill = (entry) => {
                const pill = getDonePillModel(entry, studyDayKey, t);
                return (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: pill.bg,
                      border: "1px solid " + pill.borderCol,
                      color: pill.badgeColor,
                      fontWeight: 900,
                    }}
                  >
                    {pill.label}
                  </span>
                );
              };

              const typePill = (lectureType) => {
                const lt = String(lectureType || "LEC").toUpperCase();
                const map = {
                  DLA: { bg: "#EEEDFE", fg: "#3C3489" },
                  LEC: { bg: "#E6F1FB", fg: "#0C447C" },
                  SG: { bg: "#E1F5EE", fg: "#085041" },
                  TBL: { bg: "#FAEEDA", fg: "#633806" },
                };
                const c = map[lt] || map.LEC;
                return (
                  <span style={{ fontFamily: MONO, fontSize: 10, padding: "4px 10px", borderRadius: 999, background: c.bg, color: c.fg, fontWeight: 900 }}>
                    {lt}
                  </span>
                );
              };

              const confPill = (conf) => {
                const c = String(conf || "");
                if (c === "good") return { label: "✓ Good", color: t.statusGood, bg: t.statusGoodBg, border: t.statusGoodBorder };
                if (c === "struggling") return { label: "⚠ Struggling", color: t.statusBad, bg: t.statusBadBg, border: t.statusBadBorder };
                if (c === "okay") return { label: "△ Okay", color: t.statusWarn, bg: t.statusWarnBg, border: t.statusWarnBorder };
                return { label: "○ Unseen", color: t.statusNeutral || t.text3, bg: t.inputBg, border: t.border1 };
              };

              const sortedTodayLectures = [...todayLectures].sort((a, b) => (loggedToday(a.lec.id, a.blockId) ? 1 : 0) - (loggedToday(b.lec.id, b.blockId) ? 1 : 0));

              /** Higher-priority sections claim lectures first (Today → Reviews due → Struggling → Up next). */
              const shownKeys = new Set();
              todayLectures.forEach((it) => {
                if (it.lec?.id) shownKeys.add(`${it.lec.id}__${it.blockId}`);
              });

              const daysSinceLastActivity = (lecId, blockId) => {
                const entry = completions[`${lecId}__${blockId}`];
                if (!entry?.lastActivityDate) return null;
                const d = new Date(entry.lastActivityDate);
                if (isNaN(d.getTime())) return null;
                return Math.floor((startOfStudyDay().getTime() - d.getTime()) / 86400000);
              };

              const isReviewsDuePredicate = (lec, bid) => {
                const perf = getLecPerf(lec, bid);
                const nr = perf?.nextReview ? new Date(perf.nextReview) : null;
                const endSd = endOfStudyDay();
                const isDue = nr && !isNaN(nr.getTime()) && nr <= endSd;
                const st = getLecStatus(lec.id, bid);
                if (st === "struggling") return true;
                const rawSessions = perf?.sessions || [];
                const lecSessions = rawSessions.filter((s) => !s.lectureId || s.lectureId === lec.id);
                const studiedOnce = lecSessions.length === 1;
                const daysSinceReview = daysSinceLastActivity(lec.id, bid);
                const stale = studiedOnce && daysSinceReview != null && daysSinceReview >= 3;
                return !!(isDue || stale);
              };

              const reviewsDueSectionItems = [];
              bids.forEach((bid) => {
                if (!bid) return;
                (lecs || [])
                  .filter((l) => l.blockId === bid)
                  .forEach((lec) => {
                    const rk = `${lec.id}__${bid}`;
                    if (shownKeys.has(rk)) return;
                    const comp = completionData[rk];
                    if (comp?.lastActivityDate) {
                      const lastDate = new Date(comp.lastActivityDate).toDateString();
                      if (lastDate === todayCalendarStr) return;
                    }
                    const tr = rows.find((r) => r.lectureId === lec.id || r.id === lec.id);
                    if (tr?.nextReview) {
                      const next = new Date(tr.nextReview);
                      const startOfToday = new Date();
                      startOfToday.setHours(3, 0, 0, 0);
                      if (!isNaN(next.getTime()) && next > startOfToday) return;
                    }
                    if (!isReviewsDuePredicate(lec, bid)) return;
                    const perf = getLecPerf(lec, bid);
                    const nr = perf?.nextReview ? new Date(perf.nextReview) : null;
                    const isOverdue = !!(nr && !isNaN(nr.getTime()) && nr < startOfStudyDay());
                    const daysOverdue = isOverdue && nr
                      ? Math.max(1, Math.ceil((startOfStudyDay().getTime() - nr.getTime()) / 86400000))
                      : 0;
                    reviewsDueSectionItems.push({
                      lec,
                      blockId: bid,
                      _matchReason: isOverdue ? "⏰ OVERDUE" : "🔁 REVIEW DUE",
                      isOverdue,
                      daysOverdue,
                    });
                    shownKeys.add(rk);
                  });
              });

              const sortedReviewsDue = [...reviewsDueSectionItems].sort((a, b) => {
                const aDone = loggedToday(a.lec.id, a.blockId) ? 1 : 0;
                const bDone = loggedToday(b.lec.id, b.blockId) ? 1 : 0;
                if (aDone !== bDone) return aDone - bDone;
                if (a.isNotStarted && !b.isNotStarted) return 1;
                if (b.isNotStarted && !a.isNotStarted) return -1;
                return 0;
              });

              const strugglingSectionItems = [];
              bids.forEach((bid) => {
                if (!bid) return;
                const blockObjs = getBlockObjectives(bid) || [];
                (lecs || [])
                  .filter((l) => l.blockId === bid)
                  .forEach((lec) => {
                    const rk = `${lec.id}__${bid}`;
                    if (shownKeys.has(rk)) return;
                    const lecObjs = lecObjsForLecture(blockObjs, lec);
                    if (!lecObjs.some((o) => o.status === "struggling")) return;
                    strugglingSectionItems.push({ lec, blockId: bid });
                    shownKeys.add(rk);
                  });
              });

              const sortedStrugglingDue = [...strugglingSectionItems].sort((a, b) =>
                String(a.lec?.lectureTitle || "").localeCompare(String(b.lec?.lectureTitle || ""))
              );

              const upNextCandidates = [];
              bids.forEach((bid) => {
                if (!bid) return;
                (lecs || [])
                  .filter((l) => l.blockId === bid)
                  .forEach((lec) => {
                    const rk = `${lec.id}__${bid}`;
                    if (shownKeys.has(rk)) return;
                    if (isScheduledToday(lec)) return;
                    const perf = getLecPerf(lec, bid);
                    const rawSessions = perf?.sessions || [];
                    const lecSessions = rawSessions.filter((s) => !s.lectureId || s.lectureId === lec.id);
                    if (lecSessions.length > 0) return;
                    upNextCandidates.push({ lec, blockId: bid });
                  });
              });

              upNextCandidates.sort((a, b) => {
                const wa = a.lec.weekNumber ?? 99;
                const wb = b.lec.weekNumber ?? 99;
                if (wa !== wb) return wa - wb;
                return rankDayOfWeek(a.lec.dayOfWeek) - rankDayOfWeek(b.lec.dayOfWeek);
              });

              const upNextSectionItems = upNextCandidates.slice(0, 3);
              const upNextSectionItemsVisible = upNextSectionItems.filter(({ lec, blockId: b }) => lec?.id && b && !doneSet.has(`${lec.id}__${b}`));

              const strugglingCount = searchedItems.filter((item) => {
                const key = `${item.lec.id}__${item.blockId}`;
                const ps = getLecStatus(item.lec.id, item.blockId);
                return ps === "struggling" || (ps === "untested" && completions[key]?.lastConfidence === "struggling");
              }).length;

              const examDateForBlock = (bid) => examDates[bid] || "";

              const launchDrillForRow = (lec, filter = "all") => {
                if (!lec?.id) return;
                const lecTitle = lec.lectureTitle || lec.title || lec.filename || "";
                const lecId = lec.id;
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("rxt-start-drill", {
                      detail: { lecId, lecTitle, mode: "mcq", filter },
                    })
                  );
                }, 0);
              };

              const refreshUnifiedDoneAfterLog = (lecId, blockId) => {
                if (!lecId || !blockId) return;
                const rk = `${lecId}__${blockId}`;
                setUnifiedDoneKeys((prev) => new Set([...prev, rk]));
                setExpandedTodayRow(null);
                setExpandedUpNext(null);
                try {
                  window.dispatchEvent(new CustomEvent("rxt-objectives-updated"));
                } catch {}
              };

              const logQuickRating = (lec, blockId, ratingLabel, activityTypeOverride = null) => {
                if (!lec?.id) return;
                const conf = ratingLabel === "Good" ? "good" : ratingLabel === "Okay" ? "okay" : "struggling";
                const at = activityTypeOverride || rowLogActivityFor(lec.id, blockId);
                markLectureReviewedToday(lec.id, blockId, conf, examDateForBlock(blockId), at);
                refreshUnifiedDoneAfterLog(lec.id, blockId);
                setTimeout(refreshAllData, 50);
              };

              const toggleLogWrong = (rowKey) => {
                setQuickLogWrongOnlyKey((k) => (k === rowKey ? null : rowKey));
              };

              const hasAny =
                todayLectures.length > 0 ||
                sortedReviewsDue.length > 0 ||
                sortedStrugglingDue.length > 0 ||
                upNextSectionItemsVisible.length > 0;
              if (!hasAny) {
                return (
                  <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ fontFamily: MONO, color: t.text3, fontSize: 12, marginBottom: 6 }}>Nothing scheduled today.</div>
                    <div style={{ fontFamily: MONO, color: t.text3, fontSize: 11 }}>Add lectures in the Lectures tab to begin tracking.</div>
                  </div>
                );
              }

              const mergedCompletion = { ...completionData, ...(completion || {}) };

              // Unified list (coach + scores) tracks perfData, completionData, completion, refreshKey, rows via closure; no useMemo here (hooks rule).

              const todayKeys = new Set(
                todayLectures
                  .filter((t0) => t0?.lec?.id && t0?.blockId)
                  .map((t0) => `${t0.lec.id}__${t0.blockId}`)
              );

              const getNextActionForActivity = (atype, step) => {
                switch (atype) {
                  case "lecture":
                    return {
                      label: "⚡ Jump to Drill — you've encoded it",
                      action: "drill",
                      message:
                        "You attended the lecture — your brain has encoded the material. Skip straight to retrieval practice to test what stuck.",
                    };
                  case "video":
                    return {
                      label: "💬 Do Feynman check first",
                      action: "drill",
                      message:
                        "Great — now close the video and explain the main concepts back without notes. Then drill.",
                    };
                  case "deep_learn":
                    return {
                      label: "⚡ Now Drill to test recall",
                      action: "drill",
                      message:
                        "Perfect first step. Now test yourself — retrieval practice locks in what you just learned.",
                    };
                  case "read":
                    return {
                      label: "🧠 Deep Learn recommended",
                      action: "deep_learn",
                      message:
                        "Reading slides is passive — your brain didn't process deeply. Deep Learn will actively engage you with the same material.",
                    };
                  default:
                    return {
                      label: step.actionLabel,
                      action: step.action,
                      message: step.description,
                    };
                }
              };

              const unifiedList = [
                ...todayLectures
                  .filter((t0) => t0?.lec?.id && t0?.blockId)
                  .map((t0) => {
                    const perfKey = `${t0.lec.id}__${t0.blockId}`;
                    return {
                      lec: t0.lec,
                      blockId: t0.blockId,
                      isToday: true,
                      isReview: false,
                      coach: studyCoachForToday(t0.lec, t0.blockId),
                      sessionCount: mergedCompletion[perfKey]?.sessionCount || 0,
                      lastScore: perfData[perfKey]?.score,
                    };
                  }),
                ...sortedReviewsDue
                  .filter((t0) => t0?.lec?.id && t0?.blockId)
                  .filter((t0) => !todayKeys.has(`${t0.lec.id}__${t0.blockId}`))
                  .map((t0) => {
                    const perfKey = `${t0.lec.id}__${t0.blockId}`;
                    return {
                      lec: t0.lec,
                      blockId: t0.blockId,
                      isToday: false,
                      isReview: true,
                      coach: studyCoachForToday(t0.lec, t0.blockId),
                      sessionCount: mergedCompletion[perfKey]?.sessionCount || 0,
                      lastScore: perfData[perfKey]?.score,
                    };
                  }),
              ].sort((a, b) => {
                const ka = `${a.lec.id}__${a.blockId}`;
                const kb = `${b.lec.id}__${b.blockId}`;
                const aDone = loggedToday(a.lec.id, a.blockId) || unifiedDoneKeys.has(ka) || doneSet.has(ka);
                const bDone = loggedToday(b.lec.id, b.blockId) || unifiedDoneKeys.has(kb) || doneSet.has(kb);
                if (aDone !== bDone) return aDone ? 1 : -1;
                return a.coach.currentStepIdx - b.coach.currentStepIdx;
              });

              const markRowDone = (lecId, blockId, options = {}) => {
                if (!lecId || !blockId) {
                  if (!lecId) console.error("markRowDone called without lecId");
                  if (!blockId) console.error("markRowDone called without blockId");
                  return;
                }
                const rating = options?.rating;
                const rawAt = options?.activityType;
                const act = rawAt != null && rawAt !== "" && rawAt !== "none" ? rawAt : "review";
                let conf = "okay";
                if (rating === "Good") conf = "good";
                else if (rating === "Okay") conf = "okay";
                else if (rating === "Struggling") conf = "struggling";
                const sessionDateStr =
                  options?.date != null && String(options.date).trim() !== ""
                    ? new Date(options.date).toISOString().slice(0, 10)
                    : studyDayKey;
                markLectureReviewedToday(lecId, blockId, conf, examDateForBlock(blockId), act, sessionDateStr);
                queueMicrotask(() => {
                  try {
                    const rk = completionKey(lecId, blockId);
                    const allComp = JSON.parse(localStorage.getItem("rxt-completion") || "{}");
                    const completionRecord = allComp[rk] || {};
                    const storedRows = JSON.parse(localStorage.getItem("rxt-tracker-v2") || "[]");
                    const rowIdx = storedRows.findIndex((r) => r.lectureId === lecId || r.id === lecId);
                    const rawRating = options.rating || "okay";
                    const ratingForSpacing =
                      rawRating === "Struggling" || rawRating === "struggling" ? "struggling" : rawRating;
                    const nextReview = getNextReviewDate(completionRecord.sessionCount || 1, ratingForSpacing);
                    const lastStudied = new Date().toISOString();
                    const status =
                      options.rating === "Struggling" || options.rating === "struggling" ? "struggling" : "inprogress";
                    let n;
                    if (rowIdx >= 0) {
                      n = storedRows.map((r, i) =>
                        i === rowIdx
                          ? {
                              ...r,
                              nextReview,
                              lastStudied,
                              status,
                              blockId: r.blockId || blockId,
                            }
                          : r
                      );
                    } else {
                      n = [
                        ...storedRows,
                        {
                          lectureId: lecId,
                          blockId,
                          nextReview,
                          lastStudied,
                          status,
                        },
                      ];
                    }
                    localStorage.setItem("rxt-tracker-v2", JSON.stringify(n));
                    setRows(() => n);
                    persist(n);
                    try {
                      window.dispatchEvent(new CustomEvent("rxt-deferred-cloud-sync"));
                    } catch {}
                  } catch (e) {
                    console.error("markRowDone tracker-v2 sync", e);
                  }
                });
                refreshUnifiedDoneAfterLog(lecId, blockId);
                setTimeout(() => {
                  const rk = `${lecId}__${blockId}`;
                  setDoneSet((prev) => new Set([...(prev instanceof Set ? prev : new Set()), rk]));
                  try {
                    window.dispatchEvent(new CustomEvent("rxt-tracker-refresh"));
                  } catch {}
                }, 50);
              };

              const dispatchUnifiedAction = (action, lecId, blockId, lecTitle) => {
                const title = lecTitle || "";
                setTimeout(() => {
                  if (action === "deep_learn") {
                    window.dispatchEvent(new CustomEvent("rxt-launch-deeplearn", { detail: { lecId, blockId } }));
                  } else if (action === "drill") {
                    window.dispatchEvent(
                      new CustomEvent("rxt-start-drill", { detail: { lecId, lecTitle: title, mode: "mcq", blockId } })
                    );
                  } else if (action === "quiz") {
                    window.dispatchEvent(new CustomEvent("rxt-launch-quiz", { detail: { lecId, blockId } }));
                  }
                }, 0);
              };

              return (
                <div style={{ padding: "0 16px 18px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                      gap: 12,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700 }}>📋 Today — {unifiedList.length} lectures</div>
                    <div style={{ fontSize: 11, color: t.text3 }}>Ordered by priority · Step 1 first</div>
                  </div>
                  {strugglingCount > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: "#FCEBEB",
                        border: "0.5px solid #F09595",
                        borderRadius: 8,
                        marginBottom: 10,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ flex: 1, color: "#A32D2D" }}>
                        ⚠ {strugglingCount} lectures still struggling
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setTimeout(() => {
                            window.dispatchEvent(
                              new CustomEvent("rxt-start-drill", {
                                detail: {
                                  lecId: null,
                                  mode: "mcq",
                                  filter: "struggling",
                                },
                              })
                            );
                          }, 0);
                        }}
                        style={{
                          padding: "4px 12px",
                          fontSize: 11,
                          background: "#FCEBEB",
                          color: "#A32D2D",
                          border: "0.5px solid #F09595",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontWeight: 500,
                        }}
                      >
                        ⚡ Drill all struggling →
                      </button>
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {unifiedList.map((item) => {
                      const unifiedLecId = item.lec.id;
                      const unifiedBlockId = item.blockId;
                      const unifiedLecTitle =
                        item.lec.lectureTitle || item.lec.title || item.lec.filename || "Lecture";
                      const coach = item.coach;
                      const step = coach.currentStep;
                      const rowKeyU = `${unifiedLecId}__${unifiedBlockId}`;
                      const lecObjs = blockObjectives.filter((o) => o.linkedLecId === item.lec.id);
                      const unifiedTypes = [
                        { id: "none", icon: "○", label: "Nothing yet" },
                        { id: "lecture", icon: "🎓", label: "Attended lecture" },
                        { id: "video", icon: "▶", label: "Watched video" },
                        { id: "deep_learn", icon: "🧠", label: "Did Deep Learn" },
                        { id: "read", icon: "📖", label: "Read slides" },
                        { id: "anki", icon: "🗂", label: "Did Anki" },
                        { id: "sg", icon: "👥", label: "Small group" },
                      ];
                      const selected = activityType[unifiedLecId] || "none";
                      const nextRec = getNextActionForActivity(selected, step);
                      const isDoneThisRow =
                        loggedToday(unifiedLecId, unifiedBlockId) || unifiedDoneKeys.has(rowKeyU) || doneSet.has(rowKeyU);
                      if (doneSet.has(rowKeyU)) {
                        const atId = selected;
                        const atLabel =
                          atId && atId !== "none" ? unifiedTypes.find((u) => u.id === atId)?.label || atId : null;
                        return (
                          <div
                            key={`${unifiedLecId}__${unifiedBlockId}`}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 8,
                              border: "1px solid #bbf7d0",
                              background: "#f0fdf4",
                              marginBottom: 6,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 12,
                            }}
                          >
                            <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ Logged</span>
                            <span style={{ color: "#16a34a" }}>{unifiedLecTitle}</span>
                            {atLabel ? (
                              <span style={{ color: t.textSecondary || t.text3 || "#6b7280", fontSize: 11 }}>· {atLabel}</span>
                            ) : null}
                          </div>
                        );
                      }
                      const isOpen = expandedTodayRow === unifiedLecId;
                      const maxCalDate = new Date().toISOString().split("T")[0];
                      const effectiveUnifiedLogDate = unifiedLogDateByRow[rowKeyU] || maxCalDate;
                      return (
                        <div
                          key={`${unifiedLecId}__${unifiedBlockId}`}
                          style={{
                            padding: "12px 16px",
                            borderRadius: 10,
                            border: `1px solid ${t.border1 || t.border2}`,
                            background: t.surface || t.cardBg,
                            marginBottom: 8,
                            opacity: isDoneThisRow ? 0.78 : 1,
                          }}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setExpandedTodayRow(expandedTodayRow === unifiedLecId ? null : unifiedLecId)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                setExpandedTodayRow(expandedTodayRow === unifiedLecId ? null : unifiedLecId);
                              }
                            }}
                            style={{ cursor: "pointer" }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                                  <span
                                    style={{
                                      padding: "2px 8px",
                                      borderRadius: 20,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      background: `${step.color}15`,
                                      color: step.color,
                                      border: `1px solid ${step.color}30`,
                                      whiteSpace: "nowrap",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {step.icon} Step {step.number}
                                  </span>
                                  {isDoneThisRow && (
                                    <span
                                      style={{
                                        padding: "2px 8px",
                                        borderRadius: 20,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        background: "#f0fdf4",
                                        color: "#16a34a",
                                        border: "1px solid #bbf7d0",
                                        flexShrink: 0,
                                      }}
                                    >
                                      ✓ Logged
                                    </span>
                                  )}
                                  <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: t.text1 }}>
                                    {unifiedLecTitle}
                                  </span>
                                </div>
                                <div style={{ fontSize: 11, color: step.color, fontWeight: 600, marginBottom: 2 }}>{step.title}</div>
                                {!isOpen && (
                                  <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.4 }}>{step.subtitle}</div>
                                )}
                              </div>
                              <span style={{ color: t.text3, fontSize: 12, flexShrink: 0, userSelect: "none", paddingTop: 2 }}>{isOpen ? "▲" : "▼"}</span>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11, color: t.text3 }}>
                              {item.isReview && (
                                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: t.surfaceAlt || t.inputBg, border: `1px solid ${t.border1 || t.border2}` }}>
                                  📅 REVIEW DUE
                                </span>
                              )}
                              {item.isToday && (
                                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#dbeafe", border: "1px solid #93c5fd", color: "#1d4ed8" }}>
                                  TODAY
                                </span>
                              )}
                              <span>
                                {item.sessionCount || 0} session{item.sessionCount !== 1 ? "s" : ""}
                              </span>
                              {item.lastScore != null && (
                                <span style={{ color: item.lastScore >= 80 ? t.statusGood : item.lastScore >= 60 ? t.statusWarn : t.statusBad }}>
                                  · {item.lastScore}%
                                </span>
                              )}
                            </div>
                          </div>

                          {isOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                marginTop: 12,
                                paddingTop: 12,
                                borderTop: `1px solid ${t.border1 || t.border2}`,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: t.text3,
                                  letterSpacing: "0.05em",
                                  marginBottom: 8,
                                  fontFamily: MONO,
                                }}
                              >
                                WHAT DID YOU DO WITH THIS LECTURE?
                              </div>
                              <div style={{ marginBottom: 10 }}>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: t.textSecondary || t.text3,
                                    letterSpacing: "0.05em",
                                    marginBottom: 6,
                                    fontFamily: MONO,
                                  }}
                                >
                                  WHEN?
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <input
                                    type="date"
                                    value={effectiveUnifiedLogDate}
                                    max={maxCalDate}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      setUnifiedLogDateByRow((prev) => ({
                                        ...(prev || {}),
                                        [rowKeyU]: e.target.value,
                                      }));
                                    }}
                                    style={{
                                      padding: "5px 10px",
                                      borderRadius: 6,
                                      border: `1px solid ${t.border1 || t.border2}`,
                                      background: t.surfaceAlt || t.inputBg,
                                      color: t.text1,
                                      fontSize: 12,
                                      cursor: "pointer",
                                      fontFamily: MONO,
                                    }}
                                  />
                                  {["Today", "Yesterday", "2 days ago"].map((label, i) => {
                                    const d = new Date();
                                    d.setDate(d.getDate() - i);
                                    const val = d.toISOString().split("T")[0];
                                    const isSel = effectiveUnifiedLogDate === val;
                                    return (
                                      <button
                                        key={label}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setUnifiedLogDateByRow((p) => ({ ...(p || {}), [rowKeyU]: val }));
                                        }}
                                        style={{
                                          padding: "4px 10px",
                                          borderRadius: 20,
                                          border: `1px solid ${isSel ? (t.accent || t.statusProgress || "#2563eb") : (t.border1 || t.border2)}`,
                                          background: isSel ? (t.accent || t.statusProgress || "#2563eb") : "transparent",
                                          color: isSel ? "#fff" : (t.textSecondary || t.text3),
                                          cursor: "pointer",
                                          fontSize: 11,
                                          fontFamily: MONO,
                                        }}
                                      >
                                        {label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 }}>
                                {unifiedTypes.map((type) => (
                                  <button
                                    key={type.id}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActivityType((prev) => ({ ...prev, [unifiedLecId]: type.id }));
                                    }}
                                    style={{
                                      padding: "5px 11px",
                                      borderRadius: 20,
                                      border: `1px solid ${selected === type.id ? (t.accent || t.statusProgress || "#2563eb") : (t.border1 || t.border2)}`,
                                      background: selected === type.id ? (t.accent || t.statusProgress || "#2563eb") : "transparent",
                                      color: selected === type.id ? "white" : t.text3,
                                      cursor: "pointer",
                                      fontSize: 11,
                                      fontWeight: selected === type.id ? 600 : 400,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    {type.icon} {type.label}
                                  </button>
                                ))}
                              </div>

                              <div
                                style={{
                                  padding: "10px 14px",
                                  borderRadius: 8,
                                  background: `${step.color}08`,
                                  border: `1px solid ${step.color}25`,
                                  marginBottom: 12,
                                }}
                              >
                                <div style={{ fontSize: 12, color: t.text1, lineHeight: 1.6, marginBottom: 10 }}>
                                  {selected === "none" ? step.description : nextRec.message}
                                </div>
                                <div style={{ fontSize: 11, color: step.color, fontWeight: 600, marginBottom: 8 }}>{step.title}</div>
                                <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.5, marginBottom: 10 }}>{step.subtitle}</div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const act = selected === "none" ? step.action : nextRec.action;
                                    dispatchUnifiedAction(act, unifiedLecId, unifiedBlockId, unifiedLecTitle);
                                  }}
                                  style={{
                                    padding: "8px 16px",
                                    borderRadius: 8,
                                    border: "none",
                                    background: step.color,
                                    color: "white",
                                    cursor: "pointer",
                                    fontSize: 13,
                                    fontWeight: 700,
                                    marginRight: 8,
                                  }}
                                >
                                  {selected === "none" ? `${step.actionLabel} →` : `${nextRec.label} →`}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    dispatchUnifiedAction("deep_learn", unifiedLecId, unifiedBlockId, unifiedLecTitle);
                                  }}
                                  style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    border: `1px solid ${t.border1 || t.border2}`,
                                    background: "transparent",
                                    color: t.text3,
                                    cursor: "pointer",
                                    fontSize: 12,
                                    marginRight: 6,
                                  }}
                                >
                                  🧠 Deep Learn
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    dispatchUnifiedAction("drill", unifiedLecId, unifiedBlockId, unifiedLecTitle);
                                  }}
                                  style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    border: `1px solid ${t.border1 || t.border2}`,
                                    background: "transparent",
                                    color: t.text3,
                                    cursor: "pointer",
                                    fontSize: 12,
                                    marginRight: 6,
                                  }}
                                >
                                  ⚡ Drill
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    dispatchUnifiedAction("quiz", unifiedLecId, unifiedBlockId, unifiedLecTitle);
                                  }}
                                  style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    border: `1px solid ${t.border1 || t.border2}`,
                                    background: "transparent",
                                    color: t.text3,
                                    cursor: "pointer",
                                    fontSize: 12,
                                  }}
                                >
                                  📝 Quiz
                                </button>
                              </div>

                              {step.howTo && step.howTo.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  {step.howTo.map((line, i) => (
                                    <div
                                      key={i}
                                      style={{
                                        display: "flex",
                                        gap: 8,
                                        marginBottom: 5,
                                        fontSize: 12,
                                        color: String(line || "").startsWith("⚠") ? "#d97706" : t.text1,
                                        lineHeight: 1.5,
                                      }}
                                    >
                                      <span
                                        style={{
                                          color: t.accent || t.statusProgress || "#2563eb",
                                          fontWeight: 700,
                                          flexShrink: 0,
                                          fontSize: 11,
                                          marginTop: 1,
                                        }}
                                      >
                                        {String(line || "").startsWith("Option") || String(line || "").startsWith("⚠") ? "→" : `${i + 1}.`}
                                      </span>
                                      <span>{line}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowAllSteps((prev) => ({
                                    ...prev,
                                    [item.lec.id]: !prev[item.lec.id],
                                  }));
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: "4px 0",
                                  fontSize: 11,
                                  color: t.textSecondary || t.text3,
                                  marginBottom: showAllSteps[item.lec.id] ? 8 : 12,
                                }}
                              >
                                <span>📋</span>
                                <span style={{ textDecoration: "underline" }}>
                                  {showAllSteps[item.lec.id] ? "Hide" : "View"} all {coach.totalSteps} steps
                                </span>
                              </button>

                              {showAllSteps[item.lec.id] && (
                                <div
                                  style={{
                                    marginBottom: 12,
                                    padding: "10px 12px",
                                    borderRadius: 8,
                                    background: t.surfaceAlt || t.inputBg,
                                    border: `1px solid ${t.border1 || t.border2}`,
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      color: t.textSecondary || t.text3,
                                      letterSpacing: "0.05em",
                                      marginBottom: 8,
                                    }}
                                  >
                                    YOUR LEARNING ROADMAP
                                  </div>
                                  {coach.steps.map((s, idx) => (
                                    <div
                                      key={s.id}
                                      style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 8,
                                        marginBottom: 6,
                                        opacity: s.done ? 0.5 : idx === coach.currentStepIdx ? 1 : 0.75,
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: 20,
                                          height: 20,
                                          borderRadius: "50%",
                                          background: s.done
                                            ? "#16a34a"
                                            : idx === coach.currentStepIdx
                                              ? s.color
                                              : t.border1 || t.border2,
                                          color: "white",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontSize: 9,
                                          fontWeight: 700,
                                          flexShrink: 0,
                                          marginTop: 1,
                                        }}
                                      >
                                        {s.done ? "✓" : s.number}
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <div
                                          style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: idx === coach.currentStepIdx ? s.color : t.text1,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 5,
                                          }}
                                        >
                                          {s.icon} {s.title}
                                          {idx === coach.currentStepIdx && (
                                            <span
                                              style={{
                                                fontSize: 8,
                                                padding: "1px 5px",
                                                borderRadius: 8,
                                                background: s.color,
                                                color: "white",
                                                fontWeight: 700,
                                              }}
                                            >
                                              YOU ARE HERE
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ fontSize: 10, color: t.textSecondary || t.text3, lineHeight: 1.4 }}>
                                          {s.subtitle}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {lecObjs.length > 0 && (
                                <div style={{ marginBottom: 12 }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowObjsFor((prev) => (prev === item.lec.id ? null : item.lec.id));
                                    }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      padding: "4px 0",
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: t.textSecondary || t.text3,
                                      letterSpacing: "0.05em",
                                      fontFamily: MONO,
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: 10,
                                        transform: showObjsFor === item.lec.id ? "rotate(90deg)" : "none",
                                        transition: "transform 0.15s",
                                        display: "inline-block",
                                      }}
                                    >
                                      ▶
                                    </span>
                                    OBJECTIVES ({lecObjs.length})
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontWeight: 400,
                                        color: t.textSecondary || t.text3,
                                        marginLeft: 2,
                                      }}
                                    >
                                      — tap to {showObjsFor === item.lec.id ? "hide" : "show"}
                                    </span>
                                  </button>

                                  {showObjsFor === item.lec.id && (
                                    <div
                                      style={{
                                        marginTop: 6,
                                        border: `1px solid ${t.border1 || t.border2}`,
                                        borderRadius: 8,
                                        background: t.surface || t.cardBg,
                                        overflow: "hidden",
                                      }}
                                    >
                                      {lecObjs.map((obj, i) => (
                                        <div
                                          key={obj.id || i}
                                          style={{
                                            padding: "8px 12px",
                                            borderBottom:
                                              i < lecObjs.length - 1 ? `1px solid ${t.border1 || t.border2}` : "none",
                                            fontSize: 12,
                                            color: t.text1,
                                            lineHeight: 1.5,
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: 8,
                                            fontFamily: MONO,
                                          }}
                                        >
                                          <span
                                            style={{
                                              flexShrink: 0,
                                              fontSize: 11,
                                              marginTop: 2,
                                              color:
                                                obj.status === "mastered"
                                                  ? "#16a34a"
                                                  : obj.status === "struggling"
                                                    ? "#dc2626"
                                                    : (obj.consecutiveCorrect || 0) > 0
                                                      ? "#d97706"
                                                      : t.textSecondary || t.text3,
                                            }}
                                          >
                                            {obj.status === "mastered"
                                              ? "✓"
                                              : obj.status === "struggling"
                                                ? "⚠"
                                                : (obj.consecutiveCorrect || 0) > 0
                                                  ? "◑"
                                                  : "○"}
                                          </span>
                                          <span>{obj.text}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTodayWhyOpen(todayWhyOpen === unifiedLecId ? null : unifiedLecId);
                                }}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 8,
                                  border: `1px solid ${t.border1 || t.border2}`,
                                  background: "transparent",
                                  color: t.text3,
                                  cursor: "pointer",
                                  fontSize: 12,
                                  marginBottom: todayWhyOpen === unifiedLecId ? 8 : 0,
                                }}
                              >
                                💡 Why this step?
                              </button>
                              {todayWhyOpen === unifiedLecId && step.whyItWorks && (
                                <div
                                  style={{
                                    padding: "10px 14px",
                                    background: t.surfaceAlt || t.inputBg,
                                    borderRadius: 8,
                                    fontSize: 12,
                                    color: t.text3,
                                    lineHeight: 1.6,
                                    fontStyle: "italic",
                                    borderLeft: `3px solid ${step.color}`,
                                    marginBottom: 12,
                                  }}
                                >
                                  🔬 <strong>The science:</strong> {step.whyItWorks}
                                </div>
                              )}

                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                                <select
                                  value={selectedRating[unifiedLecId] || ""}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    setSelectedRating((prev) => ({
                                      ...prev,
                                      [unifiedLecId]: e.target.value,
                                    }))
                                  }
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 6,
                                    border: `1px solid ${t.border1 || t.border2}`,
                                    background: t.surfaceAlt || t.inputBg,
                                    color: t.text1,
                                    fontSize: 12,
                                    cursor: "pointer",
                                    fontFamily: MONO,
                                  }}
                                >
                                  <option value="">How did it go?</option>
                                  <option value="Good">✓ Good</option>
                                  <option value="Okay">△ Okay</option>
                                  <option value="Struggling">⚠ Struggling</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const snapActivity = activityType[unifiedLecId];
                                    const snapRating = selectedRating[unifiedLecId];
                                    const snapDate = unifiedLogDateByRow[rowKeyU] || maxCalDate;
                                    setTimeout(() => {
                                      markRowDone(unifiedLecId, unifiedBlockId, {
                                        activityType: snapActivity,
                                        rating: snapRating,
                                        date: snapDate,
                                      });
                                    }, 0);
                                  }}
                                  style={{
                                    padding: "6px 14px",
                                    borderRadius: 6,
                                    border: `1px solid ${t.statusGood}`,
                                    background: "transparent",
                                    color: t.statusGood,
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    fontFamily: MONO,
                                  }}
                                >
                                  ✓ Log & mark done
                                </button>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                                {["Good", "Okay", "Struggling"].map((rating) => (
                                  <button
                                    key={rating}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const lid = item.lec.id;
                                      const bid = item.blockId;
                                      const rawAt = activityType[lid];
                                      const act = rawAt && rawAt !== "none" ? rawAt : "review";
                                      const snapDate = unifiedLogDateByRow[rowKeyU] || maxCalDate;
                                      setSelectedRating((prev) => ({ ...prev, [lid]: rating }));
                                      setTimeout(() => {
                                        markRowDone(lid, bid, { rating, activityType: act, date: snapDate });
                                      }, 0);
                                    }}
                                    style={{
                                      padding: "5px 10px",
                                      borderRadius: 6,
                                      border: `1px solid ${t.border1 || t.border2}`,
                                      background: "transparent",
                                      color: t.text1,
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    {rating}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* TODAY'S LECTURES (disabled stub) */}
                  {(
                  // eslint-disable-next-line no-constant-binary-expression -- disabled UI stub
                  false && todayLectures.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={sectionLabelStyle}>TODAY'S LECTURES</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {sortedTodayLectures.map((t0) => {
                          const lec = t0.lec;
                          const lbid = t0.blockId;
                          const entry = completions[`${lec.id}__${lbid}`] || null;
                          const sessions = entry?.activityLog?.length || 0;
                          const done = loggedToday(lec.id, lbid);
                          const week = lec.weekNumber != null ? `Week ${lec.weekNumber}` : "Week —";
                          const examDateL = examDates[lbid] || "";
                          const isOpen = quickLogOpenId === lec.id;
                          const handleRowToggle = () => {
                            if (done) {
                              setQuickLogOpenId(isOpen ? null : lec.id);
                              return;
                            }
                            const next = isOpen ? null : lec.id;
                            if (next && !hasSeenClickHint) markTodayClickHintSeen();
                            setQuickLogOpenId(next);
                          };
                          const handleRowKeyDown = (ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              if (done) {
                                setQuickLogOpenId(isOpen ? null : lec.id);
                                return;
                              }
                              const next = isOpen ? null : lec.id;
                              if (next && !hasSeenClickHint) markTodayClickHintSeen();
                              setQuickLogOpenId(next);
                            }
                          };
                          const todayLecRowKey = `${lec.id}__${lbid}`;
                          const todayLecConfSt = mergeTrackerDisplayStatus(lec.id, lbid, entry?.lastConfidence || null);
                          const todayLecRatingActive = (label) => {
                            const conf = label === "Good" ? "good" : label === "Okay" ? "okay" : "struggling";
                            return todayLecConfSt === conf;
                          };
                          const todayMeta = `${t0._matchReason || week} · ${sessions === 1 ? "1 session" : `${sessions} sessions`}`;
                          return (
                            <React.Fragment key={lec.id}>
                              <div
                                style={{
                                  padding: "10px 14px",
                                  borderRadius: isOpen ? "10px 10px 0 0" : 10,
                                  border: `0.5px solid ${t.border2}`,
                                  background: isOpen ? t.inputBg : t.cardBg,
                                  marginBottom: 8,
                                  opacity: done ? 0.55 : 1,
                                  transition: "background 0.1s",
                                  overflow: "hidden",
                                  boxSizing: "border-box",
                                  width: "100%",
                                  maxWidth: "100%",
                                }}
                                onMouseEnter={(ev) => {
                                  if (done && isOpen) return;
                                  if (done && !isOpen) {
                                    ev.currentTarget.style.background = t.inputBg;
                                    return;
                                  }
                                  ev.currentTarget.style.background = t.inputBg;
                                }}
                                onMouseLeave={(ev) => {
                                  if (done && isOpen) return;
                                  ev.currentTarget.style.background = isOpen ? t.inputBg : t.cardBg;
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 8,
                                    justifyContent: "space-between",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div
                                    tabIndex={0}
                                    role="button"
                                    aria-expanded={isOpen}
                                    onClick={handleRowToggle}
                                    onKeyDown={handleRowKeyDown}
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      cursor: "pointer",
                                      outline: "none",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontWeight: 600,
                                        fontSize: 14,
                                        fontFamily: MONO,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        color: t.text1,
                                      }}
                                    >
                                      {lec.lectureTitle || lec.title || lec.filename}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 11,
                                        color: t.text3,
                                        marginTop: 2,
                                        fontFamily: MONO,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {todayMeta}
                                    </div>
                                    {(() => {
                                      const coach = studyCoachForToday(lec, lbid);
                                      const step = coach.currentStep;
                                      return (
                                        <span
                                          style={{
                                            display: "inline-block",
                                            marginTop: 2,
                                            padding: "2px 7px",
                                            borderRadius: 20,
                                            fontSize: 10,
                                            fontWeight: 700,
                                            background: `${step.color}15`,
                                            color: step.color,
                                            border: `1px solid ${step.color}30`,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {step.icon} Step {step.number}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  {!done && (
                                    <div
                                      style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const lid = lec.id;
                                          const bid0 = lbid;
                                          console.log("[rxt Mark done] legacy-todays-lectures (disabled UI branch)", lid, bid0);
                                          markRowDone(lid, bid0);
                                        }}
                                        style={{
                                          padding: "4px 10px",
                                          borderRadius: 6,
                                          border: `1px solid ${t.statusGood}`,
                                          background: "transparent",
                                          color: t.statusGood,
                                          fontSize: 12,
                                          fontWeight: 600,
                                          cursor: "pointer",
                                          whiteSpace: "nowrap",
                                          fontFamily: MONO,
                                        }}
                                      >
                                        Mark done
                                      </button>
                                      <div style={{ display: "flex", gap: 4 }}>
                                        {["Good", "Okay", "Struggling"].map((rating) => (
                                          <button
                                            key={rating}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              logQuickRating(lec, lbid, rating);
                                            }}
                                            style={{
                                              padding: "4px 8px",
                                              borderRadius: 6,
                                              border: `1px solid ${t.border1}`,
                                              background: todayLecRatingActive(rating) ? t.statusProgress : "transparent",
                                              color: todayLecRatingActive(rating) ? "#fff" : t.text3,
                                              fontSize: 11,
                                              cursor: "pointer",
                                              fontFamily: MONO,
                                            }}
                                          >
                                            {rating}
                                          </button>
                                        ))}
                                      </div>
                                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            window.dispatchEvent(
                                              new CustomEvent("rxt-launch-deeplearn", {
                                                detail: { lecId: lec.id, blockId: lbid },
                                              })
                                            );
                                          }}
                                          title="Deep Learn — guided teaching"
                                          style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 6,
                                            border: `1px solid #dc2626`,
                                            background: "transparent",
                                            color: "#dc2626",
                                            cursor: "pointer",
                                            fontSize: 14,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          🧠
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            launchDrillForRow(lec, "weak_untested");
                                          }}
                                          title="Drill — rapid objective self-assess"
                                          style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 6,
                                            border: `1px solid ${t?.accent || "#2563eb"}`,
                                            background: "transparent",
                                            color: t?.accent || "#2563eb",
                                            cursor: "pointer",
                                            fontSize: 14,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          ⚡
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            window.dispatchEvent(
                                              new CustomEvent("rxt-launch-quiz", {
                                                detail: { lecId: lec.id, blockId: lbid },
                                              })
                                            );
                                          }}
                                          title="Quiz — AI clinical MCQs"
                                          style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 6,
                                            border: `1px solid #d97706`,
                                            background: "transparent",
                                            color: "#d97706",
                                            cursor: "pointer",
                                            fontSize: 14,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          📝
                                        </button>
                                      </div>
                                      {typePill(lec.lectureType)}
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRowToggle();
                                        }}
                                        onKeyDown={(ev) => {
                                          if (ev.key === "Enter" || ev.key === " ") {
                                            ev.preventDefault();
                                            handleRowToggle();
                                          }
                                        }}
                                        style={{
                                          fontSize: 14,
                                          color: isOpen ? t.text2 : t.text3,
                                          flexShrink: 0,
                                          cursor: "pointer",
                                          padding: "0 4px",
                                          transform: isOpen ? "rotate(90deg)" : "none",
                                        }}
                                      >
                                        ›
                                      </span>
                                    </div>
                                  )}
                                  {done && !isOpen && (
                                    <div
                                      style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRowToggle();
                                        }}
                                        onKeyDown={(ev) => {
                                          if (ev.key === "Enter" || ev.key === " ") {
                                            ev.preventDefault();
                                            handleRowToggle();
                                          }
                                        }}
                                        style={{
                                          fontSize: 12,
                                          color: t.text3,
                                          flexShrink: 0,
                                          cursor: "pointer",
                                          padding: "0 4px",
                                          fontFamily: MONO,
                                        }}
                                        title="Show details"
                                      >
                                        ▼
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {done && isOpen && (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      marginTop: 6,
                                      gap: 8,
                                      paddingTop: 8,
                                      borderTop: `1px solid ${t.border2}`,
                                      flexWrap: "wrap",
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div style={{ width: "100%" }}>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 600,
                                          color: t.text3,
                                          letterSpacing: "0.05em",
                                          marginBottom: 6,
                                          fontFamily: MONO,
                                        }}
                                      >
                                        WHAT DID YOU DO?
                                      </div>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                                        {ACTIVITY_TYPES.map((type) => (
                                          <button
                                            key={type.id}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setRowLogActivityFor(lec.id, lbid, type.id);
                                            }}
                                            style={{
                                              padding: "4px 10px",
                                              borderRadius: 20,
                                              border: `1px solid ${rowLogActivityFor(lec.id, lbid) === type.id ? (t.accent || t.statusProgress || "#2563eb") : (t.border1 || t.border2)}`,
                                              background: rowLogActivityFor(lec.id, lbid) === type.id ? (t.accent || t.statusProgress || "#2563eb") : "transparent",
                                              color: rowLogActivityFor(lec.id, lbid) === type.id ? "white" : t.text3,
                                              cursor: "pointer",
                                              fontSize: 11,
                                              fontWeight: rowLogActivityFor(lec.id, lbid) === type.id ? 600 : 400,
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 4,
                                              fontFamily: MONO,
                                            }}
                                          >
                                            {type.icon} {type.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div
                                      style={{ minWidth: 0, flex: "1 1 120px" }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {renderDonePill(entry)}
                                    </div>
                                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            window.dispatchEvent(
                                              new CustomEvent("rxt-launch-deeplearn", {
                                                detail: { lecId: lec.id, blockId: lbid },
                                              })
                                            );
                                          }}
                                          title="Deep Learn — guided teaching"
                                          style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 6,
                                            border: `1px solid #dc2626`,
                                            background: "transparent",
                                            color: "#dc2626",
                                            cursor: "pointer",
                                            fontSize: 14,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          🧠
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            launchDrillForRow(lec, "struggling");
                                          }}
                                          title="Drill — rapid objective self-assess"
                                          style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 6,
                                            border: `1px solid ${t?.accent || "#2563eb"}`,
                                            background: "transparent",
                                            color: t?.accent || "#2563eb",
                                            cursor: "pointer",
                                            fontSize: 14,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          ⚡
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            window.dispatchEvent(
                                              new CustomEvent("rxt-launch-quiz", {
                                                detail: { lecId: lec.id, blockId: lbid },
                                              })
                                            );
                                          }}
                                          title="Quiz — AI clinical MCQs"
                                          style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 6,
                                            border: `1px solid #d97706`,
                                            background: "transparent",
                                            color: "#d97706",
                                            cursor: "pointer",
                                            fontSize: 14,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          📝
                                        </button>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleLogWrong(todayLecRowKey);
                                        }}
                                        style={{
                                          padding: "3px 10px",
                                          borderRadius: 6,
                                          border: `1px solid ${t.border1}`,
                                          background: "transparent",
                                          color: t.text3,
                                          fontSize: 11,
                                          cursor: "pointer",
                                          fontFamily: MONO,
                                        }}
                                      >
                                        + Log wrong
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {done && isOpen && quickLogWrongOnlyKey === todayLecRowKey && (
                                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.border2}` }}>
                                    <QuickLogWrongOnlyPanel
                                      lec={lec}
                                      blockId={lbid}
                                      onCancel={() => setQuickLogWrongOnlyKey(null)}
                                      onWrongConceptsLogged={(n) => {
                                        if (n > 0) {
                                          setWeakConceptFlash({
                                            key: todayLecRowKey,
                                            count: n,
                                          });
                                        }
                                      }}
                                      onDone={() => {
                                        setQuickLogWrongOnlyKey(null);
                                        refreshAllData();
                                      }}
                                    />
                                  </div>
                                )}
                                {!done && isOpen && (
                                  <div
                                    style={{
                                      borderRadius: "0 0 10px 10px",
                                      borderTop: "0.5px solid " + t.border2,
                                      overflow: "hidden",
                                      marginTop: 8,
                                    }}
                                  >
                                    <QuickLogFormContent
                                      key={lec.id}
                                      lec={lec}
                                      blockId={lbid}
                                      examDate={examDateL}
                                      todayStr={studyDayKey}
                                      logActivity={logActivity}
                                      onWrongConceptsLogged={(n) => {
                                        if (n > 0) {
                                          setWeakConceptFlash({
                                            key: todayLecRowKey,
                                            count: n,
                                          });
                                        }
                                      }}
                                      onSave={() => {
                                        setQuickLogOpenId(null);
                                        refreshAllData();
                                      }}
                                      onCancel={() => setQuickLogOpenId(null)}
                                    />
                                  </div>
                                )}
                              </div>
                              {done && weakConceptFlash?.key === todayLecRowKey && (
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: "#A32D2D",
                                    padding: "4px 12px 0",
                                    fontFamily: MONO,
                                  }}
                                >
                                  ⚠ {weakConceptFlash.count} concept
                                  {weakConceptFlash.count !== 1 ? "s" : ""} added to Weak Concepts
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {(
                  // eslint-disable-next-line no-constant-binary-expression -- disabled UI stub
                  false && ([
                    { key: "rev", title: "REVIEWS DUE", items: sortedReviewsDue, headerStyle: sectionLabelStyle },
                    {
                      key: "strug",
                      title: "⚠ STRUGGLING",
                      items: sortedStrugglingDue,
                      headerStyle: {
                        fontFamily: MONO,
                        fontSize: 11,
                        fontWeight: 600,
                        color: t.statusBad,
                        letterSpacing: "0.08em",
                        marginBottom: 8,
                      },
                    },
                  ].map((sec) =>
                    sec.items.length === 0 ? null : (
                    <div key={sec.key} style={{ marginTop: 20 }}>
                      <div style={sec.headerStyle}>{sec.title}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {sec.items.map((t0) => {
                          const isReviewsDueSection = sec.key === "rev";
                          const lec = t0.lec;
                          const lbid = t0.blockId;
                          const entry = completions[`${lec.id}__${lbid}`] || null;
                          const sessions = entry?.activityLog?.length || 0;
                          const done = loggedToday(lec.id, lbid);
                          const conf = confPill(mergeTrackerDisplayStatus(lec.id, lbid, entry?.lastConfidence || null));
                          const dots = (entry?.activityLog || []).slice(0, 5).map((a) => a?.confidenceRating || null);
                          const dotColor = (c) => (c === "good" ? "#639922" : c === "okay" ? "#BA7517" : c === "struggling" ? "#E24B4A" : null);
                          const padded = [...dots];
                          while (padded.length < 5) padded.push(null);
                          const examDateR = examDates[lbid] || "";
                          const isOpen = quickLogOpenId === lec.id;
                          const handleRowToggle = () => {
                            if (done && !isReviewsDueSection) return;
                            if (done && isReviewsDueSection) {
                              setQuickLogOpenId(isOpen ? null : lec.id);
                              return;
                            }
                            const next = isOpen ? null : lec.id;
                            if (next && !hasSeenClickHint) markTodayClickHintSeen();
                            setQuickLogOpenId(next);
                          };
                          const handleRowKeyDown = (ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              if (done && !isReviewsDueSection) return;
                              if (done && isReviewsDueSection) {
                                setQuickLogOpenId(isOpen ? null : lec.id);
                                return;
                              }
                              const next = isOpen ? null : lec.id;
                              if (next && !hasSeenClickHint) markTodayClickHintSeen();
                              setQuickLogOpenId(next);
                            }
                          };
                          const reviewRowKey = `${lec.id}__${lbid}`;
                          const reviewConfSt = mergeTrackerDisplayStatus(lec.id, lbid, entry?.lastConfidence || null);
                          const reviewRatingActive = (label) => {
                            const conf = label === "Good" ? "good" : label === "Okay" ? "okay" : "struggling";
                            return reviewConfSt === conf;
                          };
                          return (
                            <React.Fragment key={lec.id}>
                              <div
                                style={{
                                  padding: "10px 14px",
                                  borderRadius: isOpen && (!done || isReviewsDueSection) ? "10px 10px 0 0" : 10,
                                  border: `0.5px solid ${t.border2}`,
                                  background: isOpen ? t.inputBg : t.cardBg,
                                  marginBottom: 8,
                                  opacity: done ? 0.55 : 1,
                                  transition: "background 0.1s",
                                  overflow: "hidden",
                                  boxSizing: "border-box",
                                  width: "100%",
                                  maxWidth: "100%",
                                  ...(isReviewsDueSection
                                    ? { cursor: "pointer", outline: "none" }
                                    : {}),
                                }}
                                onClick={isReviewsDueSection ? handleRowToggle : undefined}
                                onKeyDown={
                                  isReviewsDueSection
                                    ? (ev) => {
                                        if (ev.key === "Enter" || ev.key === " ") {
                                          ev.preventDefault();
                                          handleRowKeyDown(ev);
                                        }
                                      }
                                    : undefined
                                }
                                role={isReviewsDueSection ? "button" : undefined}
                                tabIndex={isReviewsDueSection ? 0 : undefined}
                                aria-expanded={isReviewsDueSection ? isOpen : undefined}
                                onMouseEnter={(ev) => {
                                  if (isReviewsDueSection) {
                                    if (done && isOpen) return;
                                    if (done && !isOpen) {
                                      ev.currentTarget.style.background = t.inputBg;
                                      return;
                                    }
                                    ev.currentTarget.style.background = t.inputBg;
                                    return;
                                  }
                                  if (done) return;
                                  ev.currentTarget.style.background = t.inputBg;
                                }}
                                onMouseLeave={(ev) => {
                                  if (isReviewsDueSection) {
                                    if (done && isOpen) return;
                                    ev.currentTarget.style.background = isOpen ? t.inputBg : t.cardBg;
                                    return;
                                  }
                                  if (done) return;
                                  ev.currentTarget.style.background = isOpen ? t.inputBg : t.cardBg;
                                }}
                              >
                                {isReviewsDueSection ? (
                                  <>
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 8,
                                      }}
                                    >
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                          style={{
                                            fontWeight: 600,
                                            fontSize: 14,
                                            fontFamily: MONO,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            color: t.text1,
                                          }}
                                        >
                                          {lec.lectureTitle || lec.title || lec.filename}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: 11,
                                            color: t.text3,
                                            marginTop: 2,
                                            fontFamily: MONO,
                                            display: "flex",
                                            flexWrap: "wrap",
                                            alignItems: "center",
                                            gap: 6,
                                            rowGap: 4,
                                          }}
                                        >
                                          <span>
                                            {t0._matchReason || "Review"} ·{" "}
                                            {sessions === 1 ? "1 session" : `${sessions} sessions`}
                                          </span>
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              gap: 3,
                                              alignItems: "center",
                                              flexShrink: 0,
                                            }}
                                          >
                                            {padded.map((c, i) => (
                                              <span
                                                key={i}
                                                style={{
                                                  width: 8,
                                                  height: 8,
                                                  borderRadius: 999,
                                                  background: c ? dotColor(c) : "transparent",
                                                  border: c ? "none" : "1px solid " + t.border2,
                                                  display: "inline-block",
                                                }}
                                              />
                                            ))}
                                          </span>
                                          <span
                                            style={{
                                              fontFamily: MONO,
                                              fontSize: 10,
                                              padding: "2px 8px",
                                              borderRadius: 999,
                                              background: conf.bg || t.inputBg,
                                              border: "1px solid " + (conf.border || t.border1),
                                              color: conf.color,
                                              fontWeight: 900,
                                            }}
                                          >
                                            {conf.label}
                                          </span>
                                        </div>
                                      </div>
                                      <span
                                        style={{
                                          fontSize: 14,
                                          color: isOpen ? t.text2 : t.text3,
                                          flexShrink: 0,
                                          transition: "transform 0.15s",
                                          transform: isOpen ? "rotate(90deg)" : "none",
                                        }}
                                      >
                                        ›
                                      </span>
                                    </div>
                                    {done && isOpen && (
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          marginTop: 6,
                                          gap: 8,
                                          paddingTop: 8,
                                          borderTop: `1px solid ${t.border2}`,
                                          flexWrap: "wrap",
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div style={{ width: "100%" }}>
                                          <div
                                            style={{
                                              fontSize: 11,
                                              fontWeight: 600,
                                              color: t.text3,
                                              letterSpacing: "0.05em",
                                              marginBottom: 6,
                                              fontFamily: MONO,
                                            }}
                                          >
                                            WHAT DID YOU DO?
                                          </div>
                                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                                            {ACTIVITY_TYPES.map((type) => (
                                              <button
                                                key={type.id}
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setRowLogActivityFor(lec.id, lbid, type.id);
                                                }}
                                                style={{
                                                  padding: "4px 10px",
                                                  borderRadius: 20,
                                                  border: `1px solid ${rowLogActivityFor(lec.id, lbid) === type.id ? (t.accent || t.statusProgress || "#2563eb") : (t.border1 || t.border2)}`,
                                              background: rowLogActivityFor(lec.id, lbid) === type.id ? (t.accent || t.statusProgress || "#2563eb") : "transparent",
                                              color: rowLogActivityFor(lec.id, lbid) === type.id ? "white" : t.text3,
                                                  cursor: "pointer",
                                                  fontSize: 11,
                                                  fontWeight: rowLogActivityFor(lec.id, lbid) === type.id ? 600 : 400,
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: 4,
                                                  fontFamily: MONO,
                                                }}
                                              >
                                                {type.icon} {type.label}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        <div
                                          style={{ minWidth: 0, flex: "1 1 120px" }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {renderDonePill(entry)}
                                        </div>
                                        <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-deeplearn", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Deep Learn — guided teaching"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #dc2626`,
                                                background: "transparent",
                                                color: "#dc2626",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              🧠
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                launchDrillForRow(lec, "struggling");
                                              }}
                                              title="Drill — rapid objective self-assess"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid ${t?.accent || "#2563eb"}`,
                                                background: "transparent",
                                                color: t?.accent || "#2563eb",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              ⚡
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-quiz", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Quiz — AI clinical MCQs"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #d97706`,
                                                background: "transparent",
                                                color: "#d97706",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              📝
                                            </button>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleLogWrong(reviewRowKey);
                                            }}
                                            style={{
                                              padding: "3px 10px",
                                              borderRadius: 6,
                                              border: `1px solid ${t.border1}`,
                                              background: "transparent",
                                              color: t.text3,
                                              fontSize: 11,
                                              cursor: "pointer",
                                              fontFamily: MONO,
                                            }}
                                          >
                                            + Log wrong
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {!done && isOpen && (
                                      <div
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                          marginTop: 8,
                                          paddingTop: 8,
                                          borderTop: `1px solid ${t.border2}`,
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            flexShrink: 0,
                                            flexWrap: "wrap",
                                            marginBottom: 8,
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const lid = lec.id;
                                              const bid0 = lbid;
                                              console.log("[rxt Mark done] legacy-reviews-due (disabled UI branch)", lid, bid0);
                                              markRowDone(lid, bid0);
                                            }}
                                            style={{
                                              padding: "4px 10px",
                                              borderRadius: 6,
                                              border: `1px solid ${t.statusGood}`,
                                              background: "transparent",
                                              color: t.statusGood,
                                              fontSize: 12,
                                              fontWeight: 600,
                                              cursor: "pointer",
                                              whiteSpace: "nowrap",
                                              fontFamily: MONO,
                                            }}
                                          >
                                            Mark done
                                          </button>
                                          <div style={{ display: "flex", gap: 4 }}>
                                            {["Good", "Okay", "Struggling"].map((rating) => (
                                              <button
                                                key={rating}
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  logQuickRating(lec, lbid, rating);
                                                }}
                                                style={{
                                                  padding: "4px 8px",
                                                  borderRadius: 6,
                                                  border: `1px solid ${t.border1}`,
                                                  background: reviewRatingActive(rating) ? t.statusProgress : "transparent",
                                                  color: reviewRatingActive(rating) ? "#fff" : t.text3,
                                                  fontSize: 11,
                                                  cursor: "pointer",
                                                  fontFamily: MONO,
                                                }}
                                              >
                                                {rating}
                                              </button>
                                            ))}
                                          </div>
                                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-deeplearn", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Deep Learn — guided teaching"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #dc2626`,
                                                background: "transparent",
                                                color: "#dc2626",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              🧠
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                launchDrillForRow(lec, "weak_untested");
                                              }}
                                              title="Drill — rapid objective self-assess"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid ${t?.accent || "#2563eb"}`,
                                                background: "transparent",
                                                color: t?.accent || "#2563eb",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              ⚡
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-quiz", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Quiz — AI clinical MCQs"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #d97706`,
                                                background: "transparent",
                                                color: "#d97706",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              📝
                                            </button>
                                          </div>
                                        </div>
                                        <div
                                          style={{
                                            borderRadius: "0 0 10px 10px",
                                            borderTop: "0.5px solid " + t.border2,
                                            overflow: "hidden",
                                            marginTop: 8,
                                          }}
                                        >
                                          <QuickLogFormContent
                                            key={lec.id}
                                            lec={lec}
                                            blockId={lbid}
                                            examDate={examDateR}
                                            todayStr={studyDayKey}
                                            logActivity={logActivity}
                                            onWrongConceptsLogged={(n) => {
                                              if (n > 0) {
                                                setWeakConceptFlash({
                                                  key: reviewRowKey,
                                                  count: n,
                                                });
                                              }
                                            }}
                                            onSave={() => {
                                              setQuickLogOpenId(null);
                                              refreshAllData();
                                            }}
                                            onCancel={() => setQuickLogOpenId(null)}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 8,
                                        justifyContent: "space-between",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <div
                                        tabIndex={done ? -1 : 0}
                                        role={done ? undefined : "button"}
                                        aria-expanded={done ? undefined : isOpen}
                                        onClick={handleRowToggle}
                                        onKeyDown={handleRowKeyDown}
                                        style={{
                                          flex: 1,
                                          minWidth: 0,
                                          cursor: done ? "default" : "pointer",
                                          outline: "none",
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontWeight: 600,
                                            fontSize: 14,
                                            fontFamily: MONO,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            color: t.text1,
                                          }}
                                        >
                                          {lec.lectureTitle || lec.title || lec.filename}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: 11,
                                            color: t.text3,
                                            marginTop: 2,
                                            fontFamily: MONO,
                                            display: "flex",
                                            flexWrap: "wrap",
                                            alignItems: "center",
                                            gap: 6,
                                            rowGap: 4,
                                          }}
                                        >
                                          <span>
                                            {t0._matchReason || "Review"} · {sessions === 1 ? "1 session" : `${sessions} sessions`}
                                          </span>
                                          <span style={{ display: "inline-flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
                                            {padded.map((c, i) => (
                                              <span
                                                key={i}
                                                style={{
                                                  width: 8,
                                                  height: 8,
                                                  borderRadius: 999,
                                                  background: c ? dotColor(c) : "transparent",
                                                  border: c ? "none" : "1px solid " + t.border2,
                                                  display: "inline-block",
                                                }}
                                              />
                                            ))}
                                          </span>
                                          <span
                                            style={{
                                              fontFamily: MONO,
                                              fontSize: 10,
                                              padding: "2px 8px",
                                              borderRadius: 999,
                                              background: conf.bg || t.inputBg,
                                              border: "1px solid " + (conf.border || t.border1),
                                              color: conf.color,
                                              fontWeight: 900,
                                            }}
                                          >
                                            {conf.label}
                                          </span>
                                        </div>
                                        {(() => {
                                          const coach = studyCoachForToday(lec, lbid);
                                          const step = coach.currentStep;
                                          return (
                                            <span
                                              style={{
                                                display: "inline-block",
                                                marginTop: 2,
                                                padding: "2px 7px",
                                                borderRadius: 20,
                                                fontSize: 10,
                                                fontWeight: 700,
                                                background: `${step.color}15`,
                                                color: step.color,
                                                border: `1px solid ${step.color}30`,
                                                whiteSpace: "nowrap",
                                              }}
                                            >
                                              {step.icon} Step {step.number}
                                            </span>
                                          );
                                        })()}
                                      </div>
                                      {!done && (
                                        <div
                                          style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const lid = lec.id;
                                              const bid0 = lbid;
                                              console.log("[rxt Mark done] legacy-struggling (disabled UI branch)", lid, bid0);
                                              markRowDone(lid, bid0);
                                            }}
                                            style={{
                                              padding: "4px 10px",
                                              borderRadius: 6,
                                              border: `1px solid ${t.statusGood}`,
                                              background: "transparent",
                                              color: t.statusGood,
                                              fontSize: 12,
                                              fontWeight: 600,
                                              cursor: "pointer",
                                              whiteSpace: "nowrap",
                                              fontFamily: MONO,
                                            }}
                                          >
                                            Mark done
                                          </button>
                                          <div style={{ display: "flex", gap: 4 }}>
                                            {["Good", "Okay", "Struggling"].map((rating) => (
                                              <button
                                                key={rating}
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  logQuickRating(lec, lbid, rating);
                                                }}
                                                style={{
                                                  padding: "4px 8px",
                                                  borderRadius: 6,
                                                  border: `1px solid ${t.border1}`,
                                                  background: reviewRatingActive(rating) ? t.statusProgress : "transparent",
                                                  color: reviewRatingActive(rating) ? "#fff" : t.text3,
                                                  fontSize: 11,
                                                  cursor: "pointer",
                                                  fontFamily: MONO,
                                                }}
                                              >
                                                {rating}
                                              </button>
                                            ))}
                                          </div>
                                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-deeplearn", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Deep Learn — guided teaching"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #dc2626`,
                                                background: "transparent",
                                                color: "#dc2626",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              🧠
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                launchDrillForRow(lec, "weak_untested");
                                              }}
                                              title="Drill — rapid objective self-assess"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid ${t?.accent || "#2563eb"}`,
                                                background: "transparent",
                                                color: t?.accent || "#2563eb",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              ⚡
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-quiz", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Quiz — AI clinical MCQs"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #d97706`,
                                                background: "transparent",
                                                color: "#d97706",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              📝
                                            </button>
                                          </div>
                                          <span
                                            role="button"
                                            tabIndex={0}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleRowToggle();
                                            }}
                                            onKeyDown={(ev) => {
                                              if (ev.key === "Enter" || ev.key === " ") {
                                                ev.preventDefault();
                                                handleRowToggle();
                                              }
                                            }}
                                            style={{
                                              fontSize: 14,
                                              color: isOpen ? t.text2 : t.text3,
                                              flexShrink: 0,
                                              cursor: "pointer",
                                              padding: "0 4px",
                                              transform: isOpen ? "rotate(90deg)" : "none",
                                            }}
                                          >
                                            ›
                                          </span>
                                        </div>
                                      )}
                                      {done && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-deeplearn", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Deep Learn — guided teaching"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #dc2626`,
                                                background: "transparent",
                                                color: "#dc2626",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              🧠
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                launchDrillForRow(lec, "weak_untested");
                                              }}
                                              title="Drill — rapid objective self-assess"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid ${t?.accent || "#2563eb"}`,
                                                background: "transparent",
                                                color: t?.accent || "#2563eb",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              ⚡
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-quiz", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Quiz — AI clinical MCQs"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #d97706`,
                                                background: "transparent",
                                                color: "#d97706",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              📝
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                    {done && (
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          marginTop: 6,
                                          gap: 8,
                                          paddingTop: 8,
                                          borderTop: `1px solid ${t.border2}`,
                                          flexWrap: "wrap",
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div style={{ width: "100%" }}>
                                          <div
                                            style={{
                                              fontSize: 11,
                                              fontWeight: 600,
                                              color: t.text3,
                                              letterSpacing: "0.05em",
                                              marginBottom: 6,
                                              fontFamily: MONO,
                                            }}
                                          >
                                            WHAT DID YOU DO?
                                          </div>
                                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                                            {ACTIVITY_TYPES.map((type) => (
                                              <button
                                                key={type.id}
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setRowLogActivityFor(lec.id, lbid, type.id);
                                                }}
                                                style={{
                                                  padding: "4px 10px",
                                                  borderRadius: 20,
                                                  border: `1px solid ${rowLogActivityFor(lec.id, lbid) === type.id ? (t.accent || t.statusProgress || "#2563eb") : (t.border1 || t.border2)}`,
                                              background: rowLogActivityFor(lec.id, lbid) === type.id ? (t.accent || t.statusProgress || "#2563eb") : "transparent",
                                              color: rowLogActivityFor(lec.id, lbid) === type.id ? "white" : t.text3,
                                                  cursor: "pointer",
                                                  fontSize: 11,
                                                  fontWeight: rowLogActivityFor(lec.id, lbid) === type.id ? 600 : 400,
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: 4,
                                                  fontFamily: MONO,
                                                }}
                                              >
                                                {type.icon} {type.label}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        <div
                                          style={{ minWidth: 0, flex: "1 1 120px" }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {renderDonePill(entry)}
                                        </div>
                                        <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-deeplearn", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Deep Learn — guided teaching"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #dc2626`,
                                                background: "transparent",
                                                color: "#dc2626",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              🧠
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                launchDrillForRow(lec, "struggling");
                                              }}
                                              title="Drill — rapid objective self-assess"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid ${t?.accent || "#2563eb"}`,
                                                background: "transparent",
                                                color: t?.accent || "#2563eb",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              ⚡
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(
                                                  new CustomEvent("rxt-launch-quiz", {
                                                    detail: { lecId: lec.id, blockId: lbid },
                                                  })
                                                );
                                              }}
                                              title="Quiz — AI clinical MCQs"
                                              style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                border: `1px solid #d97706`,
                                                background: "transparent",
                                                color: "#d97706",
                                                cursor: "pointer",
                                                fontSize: 14,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                              }}
                                            >
                                              📝
                                            </button>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleLogWrong(reviewRowKey);
                                            }}
                                            style={{
                                              padding: "3px 10px",
                                              borderRadius: 6,
                                              border: `1px solid ${t.border1}`,
                                              background: "transparent",
                                              color: t.text3,
                                              fontSize: 11,
                                              cursor: "pointer",
                                              fontFamily: MONO,
                                            }}
                                          >
                                            + Log wrong
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {!done && isOpen && (
                                      <div
                                        style={{
                                          borderRadius: "0 0 10px 10px",
                                          borderTop: "0.5px solid " + t.border2,
                                          overflow: "hidden",
                                          marginTop: 8,
                                        }}
                                      >
                                        <QuickLogFormContent
                                          key={lec.id}
                                          lec={lec}
                                          blockId={lbid}
                                          examDate={examDateR}
                                          todayStr={studyDayKey}
                                          logActivity={logActivity}
                                          onWrongConceptsLogged={(n) => {
                                            if (n > 0) {
                                              setWeakConceptFlash({
                                                key: reviewRowKey,
                                                count: n,
                                              });
                                            }
                                          }}
                                          onSave={() => {
                                            setQuickLogOpenId(null);
                                            refreshAllData();
                                          }}
                                          onCancel={() => setQuickLogOpenId(null)}
                                        />
                                      </div>
                                    )}
                                  </>
                                )}
                                {done && quickLogWrongOnlyKey === reviewRowKey && (
                                  <div
                                    onClick={isReviewsDueSection ? (e) => e.stopPropagation() : undefined}
                                    style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.border2}` }}
                                  >
                                    <QuickLogWrongOnlyPanel
                                      lec={lec}
                                      blockId={lbid}
                                      onCancel={() => setQuickLogWrongOnlyKey(null)}
                                      onWrongConceptsLogged={(n) => {
                                        if (n > 0) {
                                          setWeakConceptFlash({
                                            key: reviewRowKey,
                                            count: n,
                                          });
                                        }
                                      }}
                                      onDone={() => {
                                        setQuickLogWrongOnlyKey(null);
                                        refreshAllData();
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                              {done && weakConceptFlash?.key === reviewRowKey && (
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: "#A32D2D",
                                    padding: "4px 12px 0",
                                    fontFamily: MONO,
                                  }}
                                >
                                  ⚠ {weakConceptFlash.count} concept
                                  {weakConceptFlash.count !== 1 ? "s" : ""} added to Weak Concepts
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )
                  )))}

                  {upNextSectionItemsVisible.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          fontWeight: 600,
                          color: t.text3,
                          letterSpacing: "0.08em",
                          marginBottom: 8,
                        }}
                      >
                        ○ UP NEXT
                      </div>
                      {upNextSectionItemsVisible.map(({ lec, blockId: upBid }) => {
                        const upNextRowKey = `${lec.id}__${upBid}`;
                        const isUpNextOpen = expandedUpNext === upNextRowKey;
                        const upNextCompKey = `${lec.id}__${upBid}`;
                        const upNextCompRecord = completionData[upNextCompKey];
                        const upNextIsAlreadyLogged =
                          (upNextCompRecord?.sessionCount ?? 0) > 0 || Boolean(upNextCompRecord?.firstCompletedDate);
                        const showUpNextCompactLogged =
                          upNextIsAlreadyLogged && !lec._forceExpand && !forceExpand[lec.id];
                        const blockObjListRaw =
                          typeof getBlockObjectives === "function" ? getBlockObjectives(upBid) || [] : [];
                        const blockObjList =
                          blockObjListRaw.length > 0
                            ? blockObjListRaw.filter((o) => o && o.linkedLecId === lec.id)
                            : blockObjectives.filter((o) => o && o.linkedLecId === lec.id);
                        const upNextLecObjs = blockObjList;
                        return (
                          <div
                            key={`upnext-${upNextRowKey}`}
                            onClick={() =>
                              setExpandedUpNext((cur) => {
                                if (cur === upNextRowKey) {
                                  setForceExpand((p) => {
                                    const next = { ...p };
                                    delete next[lec.id];
                                    return next;
                                  });
                                  return null;
                                }
                                return upNextRowKey;
                              })
                            }
                            style={{
                              padding: "10px 14px",
                              borderBottom: `1px solid ${t.border2}`,
                              cursor: "pointer",
                              opacity: 0.8,
                              transition: "opacity 0.15s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.opacity = "1";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.opacity = "0.8";
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 500, fontFamily: MONO, color: t.text1 }}>
                                  {lec.lectureTitle || lec.title || lec.filename}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: t.text2 || t.text3,
                                    marginTop: 2,
                                    fontFamily: MONO,
                                  }}
                                >
                                  {lec.lectureType || "LEC"} {lec.lectureNumber ?? ""} · Week {lec.weekNumber ?? "?"} · Not
                                  started
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: t.text2 || t.text3,
                                    marginRight: 4,
                                    fontFamily: MONO,
                                  }}
                                >
                                  {isUpNextOpen ? "▲" : "▼"}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const lid = lec.id;
                                    const bid = upBid;
                                    setTimeout(() => {
                                      window.dispatchEvent(
                                        new CustomEvent("rxt-launch-deeplearn", {
                                          detail: { lecId: lid, blockId: bid },
                                        })
                                      );
                                    }, 0);
                                  }}
                                  title="Deep Learn"
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 6,
                                    border: "1px solid #dc2626",
                                    background: "transparent",
                                    color: "#dc2626",
                                    cursor: "pointer",
                                    fontSize: 13,
                                  }}
                                >
                                  🧠
                                </button>
                              </div>
                            </div>
                            {isUpNextOpen && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  marginTop: 10,
                                  paddingTop: 10,
                                  borderTop: `1px solid ${t.border2}`,
                                }}
                              >
                                {showUpNextCompactLogged ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      flexWrap: "wrap",
                                      gap: 8,
                                    }}
                                  >
                                    <div style={{ fontSize: 12, color: "#16a34a", fontFamily: MONO }}>
                                      ✓ Logged — {upNextCompRecord.sessionCount || 1} session
                                      {upNextCompRecord.sessionCount !== 1 ? "s" : ""}
                                      {upNextCompRecord.lastActivityDate && (
                                        <span style={{ color: t.text2 || t.text3, marginLeft: 6 }}>
                                          ·{" "}
                                          {new Date(upNextCompRecord.lastActivityDate).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                          })}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setForceExpand((prev) => ({ ...prev, [lec.id]: true }));
                                        }}
                                        style={{
                                          padding: "3px 10px",
                                          borderRadius: 6,
                                          border: `1px solid ${t.border1 || t.border2}`,
                                          background: "transparent",
                                          color: t.text2 || t.text3,
                                          cursor: "pointer",
                                          fontSize: 11,
                                          fontFamily: MONO,
                                        }}
                                      >
                                        Edit log
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const lid = lec.id;
                                          const bid = upBid;
                                          setTimeout(() => {
                                            window.dispatchEvent(
                                              new CustomEvent("rxt-start-drill", {
                                                detail: { lecId: lid, blockId: bid },
                                              })
                                            );
                                          }, 0);
                                        }}
                                        style={{
                                          width: 26,
                                          height: 26,
                                          borderRadius: 6,
                                          border: `1px solid ${t?.accent || "#2563eb"}`,
                                          background: "transparent",
                                          color: t?.accent || "#2563eb",
                                          cursor: "pointer",
                                          fontSize: 12,
                                        }}
                                        title="Drill"
                                      >
                                        ⚡
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const lid = lec.id;
                                          const bid = upBid;
                                          setTimeout(() => {
                                            window.dispatchEvent(
                                              new CustomEvent("rxt-launch-quiz", {
                                                detail: { lecId: lid, blockId: bid },
                                              })
                                            );
                                          }, 0);
                                        }}
                                        style={{
                                          width: 26,
                                          height: 26,
                                          borderRadius: 6,
                                          border: "1px solid #d97706",
                                          background: "transparent",
                                          color: "#d97706",
                                          cursor: "pointer",
                                          fontSize: 12,
                                        }}
                                        title="Quiz"
                                      >
                                        📝
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                                  <div style={{ width: "100%", marginBottom: 10 }}>
                                    <div
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: t.text3,
                                        letterSpacing: "0.05em",
                                        marginBottom: 6,
                                        fontFamily: MONO,
                                      }}
                                    >
                                      WHAT DID YOU DO?
                                    </div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                      {ACTIVITY_TYPES.map((type) => (
                                        <button
                                          key={type.id}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setRowLogActivityFor(lec.id, upBid, type.id);
                                          }}
                                          style={{
                                            padding: "4px 10px",
                                            borderRadius: 20,
                                            border: `1px solid ${rowLogActivityFor(lec.id, upBid) === type.id ? (t.accent || t.statusProgress || "#2563eb") : (t.border1 || t.border2)}`,
                                              background: rowLogActivityFor(lec.id, upBid) === type.id ? (t.accent || t.statusProgress || "#2563eb") : "transparent",
                                              color: rowLogActivityFor(lec.id, upBid) === type.id ? "white" : t.text3,
                                            cursor: "pointer",
                                            fontSize: 11,
                                            fontWeight: rowLogActivityFor(lec.id, upBid) === type.id ? 600 : 400,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                            fontFamily: MONO,
                                          }}
                                        >
                                          {type.icon} {type.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  {upNextLecObjs.length > 0 && (
                                    <div style={{ width: "100%", marginBottom: 12 }}>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 600,
                                          color: t.text3,
                                          letterSpacing: "0.05em",
                                          marginBottom: 6,
                                          fontFamily: MONO,
                                        }}
                                      >
                                        OBJECTIVES ({upNextLecObjs.length})
                                      </div>
                                      <div
                                        style={{
                                          maxHeight: 150,
                                          overflowY: "auto",
                                          border: `1px solid ${t.border1 || t.border2}`,
                                          borderRadius: 6,
                                        }}
                                      >
                                        {upNextLecObjs.map((obj, i) => {
                                          const objText = (obj.text || obj.objective || "").trim();
                                          return (
                                            <div
                                              key={obj.id || `obj-${i}`}
                                              style={{
                                                padding: "6px 10px",
                                                borderBottom:
                                                  i < upNextLecObjs.length - 1 ? `1px solid ${t.border1 || t.border2}` : "none",
                                                fontSize: 12,
                                                color: t.text1,
                                                lineHeight: 1.4,
                                                display: "flex",
                                                alignItems: "flex-start",
                                                gap: 8,
                                                fontFamily: MONO,
                                              }}
                                            >
                                              <span
                                                style={{
                                                  color:
                                                    obj.status === "mastered"
                                                      ? "#16a34a"
                                                      : obj.status === "struggling"
                                                        ? "#dc2626"
                                                        : t.text3,
                                                  flexShrink: 0,
                                                  fontSize: 11,
                                                  marginTop: 1,
                                                }}
                                              >
                                                {obj.status === "mastered" ? "✓" : obj.status === "struggling" ? "⚠" : "○"}
                                              </span>
                                              <span>{objText || "—"}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const idSnap = lec.id;
                                      const bidSnap = upBid;
                                      console.log("[rxt Mark done] up-next", idSnap, bidSnap);
                                      setTimeout(() => {
                                        markRowDone(idSnap, bidSnap);
                                      }, 0);
                                    }}
                                    style={{
                                      padding: "5px 12px",
                                      borderRadius: 6,
                                      border: `1px solid ${t.statusGood}`,
                                      background: "transparent",
                                      color: t.statusGood,
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    ✓ Mark done
                                  </button>
                                  {["Good", "Okay", "Struggling"].map((r) => (
                                    <button
                                      key={r}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const lid = lec.id;
                                        const bidSnap = upBid;
                                        const r0 = r;
                                        const atSnap = rowLogActivityFor(lid, bidSnap);
                                        setTimeout(() => {
                                          markRowDone(lid, bidSnap, { rating: r0, activityType: atSnap });
                                        }, 0);
                                      }}
                                      style={{
                                        padding: "5px 10px",
                                        borderRadius: 6,
                                        border: `1px solid ${t.border1}`,
                                        background: "transparent",
                                        color: t.text1,
                                        cursor: "pointer",
                                        fontSize: 12,
                                        fontFamily: MONO,
                                      }}
                                    >
                                      {r}
                                    </button>
                                  ))}
                                </div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const lid = lec.id;
                                      const bid = upBid;
                                      setTimeout(() => {
                                        window.dispatchEvent(
                                          new CustomEvent("rxt-launch-deeplearn", {
                                            detail: { lecId: lid, blockId: bid },
                                          })
                                        );
                                      }, 0);
                                    }}
                                    style={{
                                      padding: "5px 12px",
                                      borderRadius: 6,
                                      border: "1px solid #dc2626",
                                      background: "transparent",
                                      color: "#dc2626",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    🧠 Deep Learn
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const lid = lec.id;
                                      const bid = upBid;
                                      setTimeout(() => {
                                        window.dispatchEvent(
                                          new CustomEvent("rxt-start-drill", {
                                            detail: { lecId: lid, blockId: bid },
                                          })
                                        );
                                      }, 0);
                                    }}
                                    style={{
                                      padding: "5px 12px",
                                      borderRadius: 6,
                                      border: `1px solid ${t?.accent || "#2563eb"}`,
                                      background: "transparent",
                                      color: t?.accent || "#2563eb",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    ⚡ Drill
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const lid = lec.id;
                                      const bid = upBid;
                                      setTimeout(() => {
                                        window.dispatchEvent(
                                          new CustomEvent("rxt-launch-quiz", {
                                            detail: { lecId: lid, blockId: bid },
                                          })
                                        );
                                      }, 0);
                                    }}
                                    style={{
                                      padding: "5px 12px",
                                      borderRadius: 6,
                                      border: "1px solid #d97706",
                                      background: "transparent",
                                      color: "#d97706",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    📝 Quiz
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedUpNext(upNextRowKey);
                                      toggleLogWrong(upNextRowKey);
                                    }}
                                    style={{
                                      padding: "5px 12px",
                                      borderRadius: 6,
                                      border: `1px solid ${t.border1}`,
                                      background: "transparent",
                                      color: t.text2 || t.text3,
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    + Log wrong
                                  </button>
                                </div>
                                {quickLogWrongOnlyKey === upNextRowKey && (
                                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border2}` }}>
                                    <QuickLogWrongOnlyPanel
                                      lec={lec}
                                      blockId={upBid}
                                      onCancel={() => setQuickLogWrongOnlyKey(null)}
                                      onWrongConceptsLogged={(n) => {
                                        if (n > 0) {
                                          setWeakConceptFlash({
                                            key: upNextRowKey,
                                            count: n,
                                          });
                                        }
                                      }}
                                      onDone={() => {
                                        setQuickLogWrongOnlyKey(null);
                                        refreshAllData();
                                      }}
                                    />
                                  </div>
                                )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 📅 Schedule — Exam countdown + smart daily study scheduler (disabled stub) */}
            {(
            // eslint-disable-next-line no-constant-binary-expression -- disabled UI stub
            false && (() => {
              const blockId =
                filter !== "All"
                  ? (Object.values(blocks || {}).find((b) => b.name === filter || b.id === filter)?.id)
                  : activeBlock?.id;
              const block = blockId
                ? Object.values(blocks || {}).find((b) => b.id === blockId)
                : Object.values(blocks || {})[0];
              const bid = block?.id || blockId;
              if (!bid) return null;

              const examDate = examDates[bid] || "";
              const result = examDate && generateDailySchedule ? generateDailySchedule(bid, examDate) : null;
              const daysLeft = result?.daysLeft ?? 0;
              const scheduleBase = result?.schedule ?? [];

              const countdownColor =
                daysLeft <= 7 ? t.statusBad : daysLeft <= 14 ? t.statusWarn : t.statusGood;
              const tc = termColor || block?.termColor || t.red;
              const T = t;

              const PressureBanner = ({ examDate }) => {
                if (!examDate) return null;
                const p = getPressureZone(examDate);
                if (p.days <= 0) return null;
                const color =
                  p.zone === "critical" || p.zone === "exam"
                    ? T.statusBad
                    : p.zone === "crunch"
                      ? T.statusWarn
                      : p.zone === "build"
                        ? T.statusProgress
                        : T.statusGood;
                const desc =
                  p.zone === "normal"
                    ? "Standard spacing active. Keeping you on track."
                    : p.zone === "build"
                      ? "Intervals tightening. Prioritising weak lectures."
                      : p.zone === "crunch"
                        ? "Exam week mode. Daily limit raised, weak lectures first."
                        : p.zone === "critical"
                          ? "Final push. All struggling and unseen lectures surfaced."
                          : "Exam day. Showing final review items only.";

                return (
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid " + (color + "40"),
                      background: color + "12",
                      borderLeft: "4px solid " + color,
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 900, color }}>
                      {p.days}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 900, color }}>
                        {p.label}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: T.text2 }}>
                        {desc}
                      </div>
                    </div>
                  </div>
                );
              };

              // Overdue section (dedicated, above schedule)
              const todayISO = studyDayKeyNow();
              const overdueList = getOverdueLectures(bid, completion || {});
              const overdueIds = new Set(overdueList.map((e) => e.lectureId).filter(Boolean));

              const snoozeReview = (lectureId, blockId) => {
                const key = `${lectureId}__${blockId}`;
                if (snoozedToday[key] === todayISO) return;
                setSnoozedToday((p) => ({ ...(p || {}), [key]: todayISO }));
                setCompletion((prev) => {
                  const ex = (prev || {})[key];
                  if (!ex) return prev;
                  const dayStart = startOfStudyDay();
                  const nextCal = new Date(dayStart);
                  nextCal.setDate(nextCal.getDate() + 1);
                  const tomorrowKey = studyDayKeyFromDate(nextCal);
                  const rd = Array.isArray(ex.reviewDates) ? ex.reviewDates : [];
                  const pushed = rd.map((d) => {
                    const rd0 = new Date(d);
                    rd0.setHours(0, 0, 0, 0);
                    return rd0 < dayStart ? tomorrowKey : d;
                  });
                  const deduped = Array.from(new Set(pushed)).sort();
                  return { ...(prev || {}), [key]: { ...ex, reviewDates: deduped } };
                });
              };

              // Pass 0 — add review-due + Saturday sweep items (from rxt-completion)
              // When sweepMode, override entirely with sweep-eligible + untouched list.
              const schedule = (() => {
                if (sweepMode) {
                  const today = startOfStudyDay();
                  const oneWeekAgo = new Date(today);
                  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                  const todayISO = studyDayKeyNow();
                  const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
                  const lecById = new Map(blockLecs.map((l) => [l.id, l]));
                  const completionsList = Object.values(completion || {}).filter((c) => c && c.blockId === bid);
                  const sweepEntries = completionsList.filter((c) => {
                    if (!c.lastActivityDate) return false;
                    const last = new Date(c.lastActivityDate);
                    last.setHours(0, 0, 0, 0);
                    return last >= oneWeekAgo && last < today;
                  });
                  const confOrder = { struggling: 0, okay: 1, good: 2 };
                  const interactionCount = (c) => (Array.isArray(c.activityLog) ? c.activityLog.length : 0);
                  sweepEntries.sort((a, b) => {
                    const ac = confOrder[a.lastConfidence] ?? 1;
                    const bc = confOrder[b.lastConfidence] ?? 1;
                    if (ac !== bc) return ac - bc;
                    return interactionCount(a) - interactionCount(b);
                  });
                  const sweepTasks = sweepEntries.map((c) => {
                    const lec = lecById.get(c.lectureId);
                    return lec ? { lec, matchReason: "🔁 Weekly sweep", sessions: 0, struggling: 0, recommendedSessions: [{ type: "review", label: "Review", reason: "Weekly sweep", duration: 10 }] } : null;
                  }).filter(Boolean);
                  const untouchedLecs = blockLecs.filter((l) => {
                    const e = (completion || {})[`${l.id}__${bid}`];
                    return !e || !e.lastActivityDate;
                  });
                  const untouchedTasks = untouchedLecs.map((lec) => ({ lec, matchReason: "○ Not touched this week", sessions: 0, struggling: 0, recommendedSessions: [{ type: "review", label: "Review", reason: "Not touched this week", duration: 10 }] }));
                  return [{ dateStr: todayISO, tasks: [...sweepTasks, ...untouchedTasks] }];
                }
                const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
                const lecById = new Map(blockLecs.map((l) => [l.id, l]));
                const weekStartISO = (dateStr) => {
                  const d = new Date(dateStr + "T00:00:00");
                  d.setHours(0, 0, 0, 0);
                  const day = d.getDay(); // 0 Sun ... 6 Sat
                  const delta = day === 0 ? -6 : 1 - day; // Monday start
                  d.setDate(d.getDate() + delta);
                  d.setHours(0, 0, 0, 0);
                  return d.toISOString().slice(0, 10);
                };

                return (scheduleBase || []).map((day) => {
                  const dayStr = day?.dateStr;
                  if (!dayStr) return day;
                  const existing = new Set((day.tasks || []).map((t) => t?.lec?.id).filter(Boolean));
                  const extra = [];

                  // Reviews due today or overdue (any reviewDates <= today) and no activity logged today
                  Object.values(completion || {}).forEach((c) => {
                    if (!c || c.blockId !== bid) return;
                    const rd = Array.isArray(c.reviewDates) ? c.reviewDates : [];
                    const lastAct = c.lastActivityDate || null;
                    if (lastAct === dayStr) return; // already did something today
                    const due = rd.filter((d) => d <= dayStr);
                    if (due.length === 0) return;
                    const earliest = due.sort()[0];
                    const label = earliest === dayStr ? "🔁 DUE TODAY" : "🔁 REVIEW DUE";
                    const lec = lecById.get(c.lectureId);
                    if (lec && !existing.has(lec.id) && !overdueIds.has(lec.id)) {
                      extra.push({
                        lec,
                        matchReason: label,
                        sessions: 0,
                        struggling: 0,
                        recommendedSessions: [
                          { type: "review", label: "Review", reason: label === "🔁 DUE TODAY" ? "Due today" : "Overdue review", duration: 10 },
                        ],
                      });
                    }
                  });

                  // Saturday sweep: include all lectures with lastActivityDate in past 7 days that have not had any activity logged today
                  const isSaturday = new Date(dayStr + "T00:00:00").getDay() === 6;
                  if (isSaturday) {
                    const wkStart = weekStartISO(dayStr);
                    Object.values(completion || {}).forEach((c) => {
                      if (!c || c.blockId !== bid) return;
                      const lastAct = c.lastActivityDate;
                      if (!lastAct || lastAct < wkStart || lastAct > dayStr) return;
                      if (lastAct === dayStr) return;
                      const lec = lecById.get(c.lectureId);
                      if (lec && !existing.has(lec.id) && !overdueIds.has(lec.id)) {
                        extra.push({
                          lec,
                          matchReason: "📅 WEEKLY SWEEP",
                          sessions: 0,
                          struggling: 0,
                          recommendedSessions: [
                            { type: "review", label: "Weekly sweep", reason: "Saturday sweep", duration: 12 },
                          ],
                        });
                      }
                    });
                  }

                  return extra.length ? { ...day, tasks: [...extra, ...(day.tasks || [])] } : day;
                });
              })();

              return (
                <div style={{ marginBottom: 28, padding: "0 16px 0" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      marginBottom: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1.5 }}>
                      📅 EXAM SCHEDULE
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>
                        Exam date:
                      </span>
                      <input
                        type="date"
                        value={examDate}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => saveExamDate && saveExamDate(bid, e.target.value)}
                        style={{
                          background: T.inputBg,
                          border: "1px solid " + T.border1,
                          borderRadius: 7,
                          padding: "6px 10px",
                          color: T.text1,
                          fontFamily: MONO,
                          fontSize: 12,
                        }}
                      />
                    </div>

                    {daysLeft > 0 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 14px",
                          borderRadius: 20,
                          background: countdownColor + "15",
                          border: "1px solid " + countdownColor + "40",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: MONO,
                            color: countdownColor,
                            fontSize: 18,
                            fontWeight: 900,
                          }}
                        >
                          {daysLeft}
                        </span>
                        <span style={{ fontFamily: MONO, color: countdownColor, fontSize: 11 }}>
                          days until exam
                        </span>
                      </div>
                    )}
                  </div>

                  <PressureBanner examDate={examDate} />

                  {(() => {
                    const sweepBannerState = getSweepBannerState(bid, completion || {}, lecs || []);
                    return sweepBannerState && !sweepMode ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: "1px solid " + ((sweepBannerState.dayOfWeek === 5 ? T.statusProgress : sweepBannerState.dayOfWeek === 6 ? T.statusWarn : T.statusBad) + "40"),
                          background: (sweepBannerState.dayOfWeek === 5 ? T.statusProgress : sweepBannerState.dayOfWeek === 6 ? T.statusWarn : T.statusBad) + "12",
                          borderLeft: "4px solid " + (sweepBannerState.dayOfWeek === 5 ? T.statusProgress : sweepBannerState.dayOfWeek === 6 ? T.statusWarn : T.statusBad),
                          marginBottom: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 900, color: sweepBannerState.dayOfWeek === 5 ? T.statusProgress : sweepBannerState.dayOfWeek === 6 ? T.statusWarn : T.statusBad }}>📅 {sweepBannerState.dayOfWeek === 5 ? "FRI" : sweepBannerState.dayOfWeek === 6 ? "SAT" : "SUN"}</span>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 900, color: T.text1 }}>{sweepBannerState.label}</div>
                          <div style={{ fontFamily: MONO, fontSize: 11, color: T.text2 }}>
                            [{sweepBannerState.sweepCount}] lectures to sweep · [{sweepBannerState.untouchedCount}] never touched this week
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSweepMode(true);
                            sweepModeEnteredDateRef.current = new Date().toISOString().slice(0, 10);
                          }}
                          style={{ fontFamily: MONO, fontSize: 11, padding: "8px 14px", borderRadius: 8, border: "none", background: sweepBannerState.dayOfWeek === 5 ? T.statusProgress : sweepBannerState.dayOfWeek === 6 ? T.statusWarn : T.statusBad, color: "#fff", cursor: "pointer", fontWeight: 900 }}
                        >
                          Start Sweep
                        </button>
                      </div>
                    ) : null;
                  })()}

                  {sweepMode && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: T.inputBg || (T.border1 + "22"), border: "1px solid " + T.border2, borderRadius: 8 }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: T.text1 }}>Sweep mode — showing this week&apos;s lectures</span>
                      <button type="button" onClick={() => { setSweepMode(false); sweepModeEnteredDateRef.current = null; }} style={{ fontFamily: MONO, fontSize: 11, padding: "4px 8px", border: "none", background: T.border1, color: T.text2, borderRadius: 6, cursor: "pointer", fontWeight: 800 }}>✕ exit</button>
                    </div>
                  )}

                  {(() => {
                    const blockLectures = (lecs || []).filter((l) => l.blockId === bid);
                    const cached = (() => {
                      try {
                        const raw = localStorage.getItem("rxt-weak-areas");
                        const data = raw ? JSON.parse(raw) : null;
                        const tenMin = 10 * 60 * 1000;
                        if (data && data.blockId === bid && data.computedAt && Date.now() - data.computedAt < tenMin && Array.isArray(data.clusters)) {
                          return data.clusters;
                        }
                      } catch {}
                      const computed = computeWeakClusters(bid, completion || {}, blockLectures);
                      try {
                        localStorage.setItem("rxt-weak-areas", JSON.stringify({ blockId: bid, computedAt: Date.now(), clusters: computed }));
                      } catch {}
                      return computed;
                    })();
                    const displayClusters = weakAreaShowStrong ? cached : cached.filter((c) => c.level === "critical" || c.level === "weak" || c.level === "gaps");
                    const levelBarColor = (level) => (level === "critical" ? T.statusBad : level === "weak" ? T.statusWarn : level === "gaps" ? T.statusProgress : T.statusGood);
                    const levelStatus = (c) => {
                      if (c.level === "critical") return { label: `⚠ [${c.strugglingCount}] struggling`, color: T.statusBad };
                      if (c.level === "weak") return { label: "△ Weak cluster", color: T.statusWarn };
                      if (c.level === "gaps") return { label: `○ [${c.untouchedCount}] not started`, color: T.statusNeutral || T.text4 };
                      return { label: "✓ Looking good", color: T.statusGood };
                    };
                    return (
                      <div style={{ marginBottom: 14 }}>
                        <div
                          onClick={() => setWeakAreaSummaryOpen((o) => !o)}
                          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontFamily: MONO, fontSize: 12, fontWeight: 900, color: T.text2, marginBottom: 8, userSelect: "none" }}
                        >
                          <span style={{ fontSize: 10 }}>{weakAreaSummaryOpen ? "▾" : "▸"}</span>
                          Block weak area summary
                        </div>
                        {weakAreaSummaryOpen && (
                          <>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setWeakAreaShowStrong((s) => !s); }}
                                style={{ fontFamily: MONO, fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid " + T.border1, background: weakAreaShowStrong ? T.inputBg : "transparent", color: T.text3, cursor: "pointer" }}
                              >
                                {weakAreaShowStrong ? "Hide strong areas" : "Show strong areas too"}
                              </button>
                            </div>
                            {displayClusters.map((cluster, idx) => {
                              const status = levelStatus(cluster);
                              const barColor = levelBarColor(cluster.level);
                              const barPct = Math.min(100, (cluster.avgScore / 3) * 100);
                              const weekLabel = String(cluster.week) === "unscheduled" ? "Unscheduled" : "Week " + cluster.week;
                              return (
                                <div
                                  key={`${cluster.week}-${cluster.type}-${idx}`}
                                  onClick={() => setWeakAreaFilter({ week: cluster.week, type: cluster.type })}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "8px 12px",
                                    marginBottom: 6,
                                    background: T.cardBg,
                                    border: "1px solid " + T.border2,
                                    borderRadius: 8,
                                    cursor: "pointer",
                                  }}
                                >
                                  <span style={{ fontFamily: MONO, fontSize: 11, color: T.text1, minWidth: 56 }}>{weekLabel}</span>
                                  <span style={{ fontFamily: MONO, fontSize: 10, padding: "2px 8px", borderRadius: 999, border: "1px solid " + (T.statusProgress || T.border1), background: (T.statusProgress || T.border1) + "22", color: T.text1 }}>{cluster.type}</span>
                                  <div style={{ flex: 1, minWidth: 80, height: 18, background: T.inputBg || (T.border1 + "40"), borderRadius: 4, overflow: "hidden" }}>
                                    <div style={{ width: barPct + "%", height: "100%", background: barColor, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                      <span style={{ fontFamily: MONO, fontSize: 9, color: barPct > 40 ? "#fff" : T.text1 }}>{cluster.totalCount - cluster.untouchedCount}/{cluster.totalCount} lectures</span>
                                    </div>
                                  </div>
                                  <span style={{ fontFamily: MONO, fontSize: 11, color: status.color, fontWeight: 800 }}>{status.label}</span>
                                </div>
                              );
                            })}
                            {displayClusters.length === 0 && (
                              <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, padding: 8 }}>No weak clusters in this block</div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {overdueList.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 900, color: T.statusBad }}>
                          ⚠ {overdueList.length} overdue review{overdueList.length !== 1 ? "s" : ""}
                        </div>
                        <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3 }}>
                          These were scheduled and missed — log them or reschedule
                        </div>
                      </div>

                      {overdueList.map((entry) => {
                        const lec = (lecs || []).find((l) => l.id === entry.lectureId) || null;
                        const key = `${entry.lectureId}__${bid}`;
                        const lastAct = entry.lastActivityDate ? new Date(entry.lastActivityDate) : null;
                        const lastActLabel = lastAct ? lastAct.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
                        const lastIcon = entry.activityLog?.[0]?.activityType ? mapActivityIcon(entry.activityLog[0].activityType) : "✏️";
                        const conf = entry.lastConfidence || "okay";
                        const confBadge =
                          conf === "good" ? { label: "✓ Good", color: T.statusGood }
                            : conf === "struggling" ? { label: "⚠ Struggling", color: T.statusBad }
                              : { label: "△ Okay", color: T.statusWarn };
                        const open = !!overdueOpen[key];
                        const snoozed = snoozedToday[key] === todayISO;

                        return (
                          <div key={key} style={{ background: T.cardBg, border: "1px solid " + T.statusBadBorder, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ fontFamily: MONO, fontSize: 12, color: T.text1, fontWeight: 900, flex: 1, minWidth: 240 }}>
                                {(lec?.lectureType || "LEC")} {lec?.lectureNumber ?? ""} — {lec?.lectureTitle || lec?.filename || entry.lectureId}
                              </div>
                              <div style={{ fontFamily: MONO, fontSize: 11, color: T.statusBad, fontWeight: 900 }}>
                                ⚠ Overdue by {entry.daysOverdue} day{entry.daysOverdue !== 1 ? "s" : ""}
                              </div>
                              <div style={{ fontFamily: MONO, fontSize: 11, color: confBadge.color, fontWeight: 900 }}>
                                {confBadge.label}
                              </div>
                              <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3 }}>
                                {lastIcon} {lastActLabel}
                              </div>
                              <button
                                type="button"
                                onClick={() => setOverdueOpen((p) => ({ ...(p || {}), [key]: !open }))}
                                style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: T.statusBad, color: "#fff", cursor: "pointer", fontWeight: 900 }}
                              >
                                Log Now
                              </button>
                              <button
                                type="button"
                                onClick={() => snoozeReview(entry.lectureId, bid)}
                                disabled={snoozed}
                                style={{
                                  fontFamily: MONO,
                                  fontSize: 11,
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "1px solid " + T.border1,
                                  background: T.inputBg,
                                  color: T.text2,
                                  cursor: snoozed ? "default" : "pointer",
                                  opacity: snoozed ? 0.6 : 1,
                                  fontWeight: 900,
                                }}
                              >
                                {snoozed ? "Snoozed" : "Snooze 1 day"}
                              </button>
                            </div>

                            {open && (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid " + T.border2 }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                                  <span style={{ fontFamily: MONO, fontSize: 11, color: T.statusNeutral || T.text4 }}>Date completed</span>
                                  <input
                                    type="date"
                                    value={(overdueOpen[key]?.date) || todayISO}
                                    max={todayISO}
                                    onChange={(e) => setOverdueOpen((p) => ({ ...(p || {}), [key]: { ...(p?.[key] || { open: true }), date: e.target.value, confidenceRating: (p?.[key]?.confidenceRating || "okay") } }))}
                                    style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 8, padding: "6px 10px", color: T.text1, fontFamily: MONO, fontSize: 11 }}
                                  />
                                </div>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                                  {[
                                    { v: "good", label: "✓ Good", color: T.statusGood },
                                    { v: "okay", label: "△ Okay", color: T.statusWarn },
                                    { v: "struggling", label: "⚠ Struggling", color: T.statusBad },
                                  ].map((opt) => {
                                    const cur = overdueOpen[key]?.confidenceRating || "okay";
                                    const active = cur === opt.v;
                                    return (
                                      <button
                                        key={opt.v}
                                        type="button"
                                        onClick={() => setOverdueOpen((p) => ({ ...(p || {}), [key]: { ...(p?.[key] || { open: true }), confidenceRating: opt.v, date: (p?.[key]?.date || todayISO) } }))}
                                        style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid " + (active ? opt.color : T.border1), background: active ? opt.color + "18" : T.cardBg, color: active ? opt.color : T.text2, cursor: "pointer", fontWeight: 900 }}
                                      >
                                        {opt.label}
                                      </button>
                                    );
                                  })}

                                  <button
                                    type="button"
                                    onClick={() => {
                                      const d = overdueOpen[key]?.date || todayISO;
                                      const c = overdueOpen[key]?.confidenceRating || "okay";
                                      logActivity(entry.lectureId, bid, "review", c, { date: d, examDate });
                                      setOverdueOpen((p) => ({ ...(p || {}), [key]: false }));
                                    }}
                                    style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: T.statusGood, color: "#fff", cursor: "pointer", fontWeight: 900 }}
                                  >
                                    Save ✓
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {result?.needsBlockStart && updateBlock && (
                    <div
                      style={{
                        background: T.statusProgressBg,
                        border: "1px solid " + T.statusProgressBorder,
                        borderRadius: 10,
                        padding: "14px 16px",
                        marginBottom: 16,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: MONO,
                          color: T.statusProgress,
                          fontSize: 10,
                          letterSpacing: 1.5,
                          marginBottom: 6,
                        }}
                      >
                        ◑ SET BLOCK START DATE TO ENABLE SCHEDULING
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          color: T.text2,
                          fontSize: 11,
                          marginBottom: 10,
                        }}
                      >
                        Your lectures have weeks and days assigned. Set the
                        block start date above so the scheduler can calculate
                        exact lecture dates automatically.
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: MONO,
                            color: T.text3,
                            fontSize: 11,
                          }}
                        >
                          Block start date:
                        </span>
                        <input
                          type="date"
                          value={
                            (block && block.startDate) || ""
                          }
                          onChange={(e) =>
                            updateBlock(bid, { startDate: e.target.value })
                          }
                          style={{
                            background: T.inputBg,
                            border: "1px solid " + T.statusProgress,
                            borderRadius: 7,
                            padding: "6px 10px",
                            color: T.text1,
                            fontFamily: MONO,
                            fontSize: 12,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {!examDate && (
                    <div
                      style={{
                        fontFamily: MONO,
                        color: T.text3,
                        fontSize: 11,
                        padding: 14,
                        borderRadius: 8,
                        background: T.inputBg,
                        border: "1px solid " + T.border1,
                        textAlign: "center",
                      }}
                    >
                      Set your exam date above to generate a personalized study schedule
                    </div>
                  )}

                  {result?.undated?.length > 0 && (
                    <div
                      style={{
                        background: T.statusWarnBg,
                        border: "1px solid " + T.statusWarnBorder,
                        borderRadius: 10,
                        padding: "14px 16px",
                        marginBottom: 16,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: MONO,
                          color: T.statusWarn,
                          fontSize: 10,
                          letterSpacing: 1.5,
                          marginBottom: 8,
                        }}
                      >
                        △ {result.undated.length} LECTURES NEED A DATE TO BE
                        SCHEDULED
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          color: T.text2,
                          fontSize: 11,
                          marginBottom: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        These lectures have no date assigned — go to the block
                        overview and set a lecture date on each one so the
                        scheduler knows when they were or will be taught.
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        {result.undated.slice(0, 5).map((ls) => (
                          <div
                            key={ls.lec.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 10px",
                              borderRadius: 7,
                              background: T.cardBg,
                              border: "1px solid " + T.border1,
                            }}
                          >
                            {lecTypeBadge &&
                              lecTypeBadge(ls.lec.lectureType || "LEC")}
                            <span
                              style={{
                                fontFamily: MONO,
                                color: T.text2,
                                fontSize: 11,
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {ls.lec.lectureTitle || ls.lec.fileName}
                            </span>
                            <span
                              style={{
                                fontFamily: MONO,
                                color: T.statusWarn,
                                fontSize: 10,
                              }}
                            >
                              ○ No date set
                            </span>
                          </div>
                        ))}
                        {result.undated.length > 5 && (
                          <div
                            style={{
                              fontFamily: MONO,
                              color: T.text3,
                              fontSize: 10,
                              padding: "4px 10px",
                            }}
                          >
                            + {result.undated.length - 5} more...
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {schedule.length > 0 &&
                    (() => {
                      const todayKey = todayKeyForSchedule();
                      return schedule.map((day) => {
                        const isDayExpanded = expandedScheduleDays[day.dateStr] ?? (day.dateStr === todayKey);
                        const hasTasks = day.tasks.length > 0;
                        return (
                          <div key={day.dateStr} style={{ marginBottom: 16 }}>
                            {hasTasks ? (
                              <>
                                <div
                                  onClick={() => toggleScheduleDay(day.dateStr)}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    marginBottom: isDayExpanded ? 8 : 0,
                                    cursor: "pointer",
                                    userSelect: "none",
                                    padding: "4px 0",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      fontWeight: 900,
                                      fontSize: day.daysFromNow === 0 ? 14 : 12,
                                      color: day.daysFromNow === 0 ? tc : T.text2,
                                    }}
                                  >
                                    {day.dayLabel}
                                  </span>
                                  <span style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                                    {day.dateStr}
                                  </span>
                                  <div
                                    style={{
                                      flex: 1,
                                      height: 1,
                                      background: day.daysFromNow === 0 ? tc + "40" : T.border2,
                                    }}
                                  />
                                  {!isDayExpanded && (
                                    <span
                                      style={{
                                        marginLeft: 8,
                                        background: T.statusWarn,
                                        color: "white",
                                        borderRadius: 10,
                                        padding: "1px 8px",
                                        fontSize: 12,
                                        fontFamily: MONO,
                                      }}
                                    >
                                      {day.tasks.length}
                                    </span>
                                  )}
                                  {isDayExpanded && (
                                    <span style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                                      {day.tasks.length} task{day.tasks.length !== 1 ? "s" : ""}
                                      {" · "}~
                                      {day.tasks.reduce(
                                        (s, t) =>
                                          s +
                                          (t.recommendedSessions || []).reduce(
                                            (ss, r) => ss + (r.duration || 0),
                                            0
                                          ),
                                        0
                                      )}
                                      min
                                    </span>
                                  )}
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      color: T.text3,
                                      fontSize: 11,
                                      display: "inline-block",
                                      transform: isDayExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                      transition: "transform 0.2s",
                                      marginLeft: 4,
                                    }}
                                  >
                                    ▶
                                  </span>
                                </div>
                                {isDayExpanded &&
                            (() => {
                              const todayKey = todayKeyForSchedule();
                              const sortedTasks = [...(day.tasks || [])].sort((a, b) => {
                                const aLogged = hasLoggedToday(a.lec.id, bid, todayKey);
                                const bLogged = hasLoggedToday(b.lec.id, bid, todayKey);
                                if (aLogged === bLogged) return 0;
                                return aLogged ? 1 : -1;
                              });
                              return sortedTasks.map((task) => {
                              const isTaskCollapsed = collapsedScheduleTasks.has(task.lec.id);
                              const todayKeyInner = todayKeyForSchedule();
                              const quickOpen = !!quickLogState[task.lec.id]?.open;
                              const quickSubmitting = !!quickLogState[task.lec.id]?.submitting;
                              const flash = flashTaskId?.lecId === task.lec.id ? flashTaskId.color : null;
                              const loggedToday = hasLoggedToday(task.lec.id, bid, todayKeyInner);
                              const todaySummary = getTodayActivitySummary(task.lec.id, bid, todayKeyInner);
                              const cardBorderColor = quickOpen ? T.statusProgress : flash || (loggedToday && todaySummary ? (todaySummary.confidenceRating === "good" ? T.statusGood : todaySummary.confidenceRating === "struggling" ? T.statusBad : T.statusWarn) : null);
                              const baseBorder = task.struggling > 0 ? T.statusBadBorder : task.sessions === 0 ? T.statusWarnBorder : T.border1;
                              const draft = quickLogDraft[task.lec.id] || { activityType: "review", confidenceRating: "okay", note: "" };
                              return (
                                <div
                                  key={task.lec.id}
                                  style={{
                                    background: T.cardBg,
                                    border: "1px solid " + (cardBorderColor || baseBorder),
                                    borderLeft: cardBorderColor ? "3px solid " + cardBorderColor : undefined,
                                    borderRadius: 10,
                                    marginBottom: 8,
                                    overflow: "hidden",
                                    transition: "border-color 0.6s, border-left-color 0.6s",
                                  }}
                                >
                                  <div
                                    onClick={() => toggleScheduleTask(task.lec.id)}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      padding: "12px 14px",
                                      cursor: "pointer",
                                      userSelect: "none",
                                    }}
                                    onMouseEnter={(e) =>
                                      (e.currentTarget.style.background = T.hoverBg)
                                    }
                                    onMouseLeave={(e) =>
                                      (e.currentTarget.style.background = "transparent")
                                    }
                                  >
                                    {lecTypeBadge &&
                                      lecTypeBadge(task.lec.lectureType || "LEC")}
                                    <span
                                      style={{
                                        fontFamily: MONO,
                                        color: T.text1,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        flex: 1,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {task.lec.lectureTitle || task.lec.fileName}
                                    </span>
                                    {(() => {
                                      const c = getCompletion(task.lec.id, bid);
                                      if (!c?.completedDate) return null;
                                      const todayKey = todayKeyForSchedule();
                                      const reviewDates = Array.isArray(c.reviewDates) ? c.reviewDates : [];
                                      const done = Array.isArray(c.reviewsCompleted) ? c.reviewsCompleted : [];
                                      const nextReview = reviewDates.find((d) => d >= todayKey && !done.includes(d)) || null;
                                      if (!nextReview) return null;
                                      return (
                                        <span style={{ fontFamily: MONO, fontSize: 9, color: T.text3, flexShrink: 0 }}>
                                          🔁 Next {new Date(nextReview + "T00:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" })}
                                        </span>
                                      );
                                    })()}
                                    {task.matchReason && task.matchReason !== "scheduled-day" && (
                                      <span
                                        style={{
                                          fontFamily: MONO,
                                          fontSize: 9,
                                          color: T.statusProgress,
                                          fontWeight: 700,
                                          flexShrink: 0,
                                        }}
                                      >
                                        {task.matchReason}
                                      </span>
                                    )}
                                    {task.matchReason === "scheduled-day" && (
                                      <span
                                        style={{
                                          fontFamily: MONO,
                                          fontSize: 8,
                                          color: tc,
                                          background: tc + "18",
                                          padding: "1px 5px",
                                          borderRadius: 3,
                                          flexShrink: 0,
                                        }}
                                      >
                                        TODAY'S LECTURE
                                      </span>
                                    )}
                                    {task.struggling > 0 && (
                                      <span
                                        style={{
                                          fontFamily: MONO,
                                          fontSize: 9,
                                          color: T.statusBad,
                                          fontWeight: 700,
                                          flexShrink: 0,
                                        }}
                                      >
                                        ⚠ {task.struggling}
                                      </span>
                                    )}
                                    {task.sessions === 0 && (
                                      <span
                                        style={{
                                          fontFamily: MONO,
                                          fontSize: 9,
                                          color: T.statusWarn,
                                          flexShrink: 0,
                                        }}
                                      >
                                        ○ New
                                      </span>
                                    )}
                                    <span
                                      style={{
                                        fontFamily: MONO,
                                        fontSize: 9,
                                        color: T.text3,
                                        flexShrink: 0,
                                      }}
                                    >
                                      {(task.recommendedSessions || []).length} task
                                      {(task.recommendedSessions || []).length !== 1 ? "s" : ""}
                                    </span>
                                    <span
                                      style={{
                                        fontFamily: MONO,
                                        color: T.text3,
                                        fontSize: 11,
                                        display: "inline-block",
                                        transform: isTaskCollapsed
                                          ? "rotate(0deg)"
                                          : "rotate(90deg)",
                                        transition: "transform 0.2s",
                                        flexShrink: 0,
                                      }}
                                    >
                                      ▶
                                    </span>
                                  </div>

                                  {!isTaskCollapsed && (
                                    <div
                                      style={{
                                        padding: "0 14px 12px",
                                        borderTop: "1px solid " + T.border2,
                                      }}
                                    >
                                      {(() => {
                                        const c = getCompletion(task.lec.id, bid);
                                        const cKey = completionKey(task.lec.id, bid);
                                        const draft = completionDrafts?.[cKey] || null;
                                        const todayKey = todayKeyForSchedule();
                                        const reviewDates = Array.isArray(c?.reviewDates) ? c.reviewDates : [];
                                        const done = Array.isArray(c?.reviewsCompleted) ? c.reviewsCompleted : [];
                                        const nextReview = reviewDates.find((d) => d >= todayKey && !done.includes(d)) || null;
                                        const completedLabel = c?.completedDate
                                          ? new Date(c.completedDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                                          : null;

                                        const dot = (d) => {
                                          const filled = done.includes(d);
                                          return (
                                            <div
                                              key={d}
                                              title={d}
                                              style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: 999,
                                                background: filled ? T.statusGood : "transparent",
                                                border: "1.5px solid " + (filled ? T.statusGood : T.border1),
                                              }}
                                            />
                                          );
                                        };

                                        if (!c?.completedDate) {
                                          return (
                                            <div style={{ marginTop: 10, marginBottom: 10 }}>
                                              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                                                  <input
                                                    type="checkbox"
                                                    checked={!!draft?.open}
                                                    onChange={(e) => {
                                                      const open = e.target.checked;
                                                      setCompletionDrafts((prev) => ({
                                                        ...(prev || {}),
                                                        [cKey]: open ? { open: true, ankiInRotation: false, confidenceRating: "okay" } : null,
                                                      }));
                                                    }}
                                                  />
                                                  <span style={{ fontFamily: MONO, fontSize: 12, color: T.text2 }}>
                                                    ✓ Completed today
                                                  </span>
                                                </label>

                                                {draft?.open && (
                                                  <>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                      <span style={{ fontFamily: MONO, fontSize: 11, color: T.text3 }}>Anki in rotation?</span>
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          setCompletionDrafts((prev) => ({
                                                            ...(prev || {}),
                                                            [cKey]: { ...draft, ankiInRotation: !draft.ankiInRotation },
                                                          }))
                                                        }
                                                        style={{
                                                          fontFamily: MONO,
                                                          fontSize: 11,
                                                          padding: "4px 10px",
                                                          borderRadius: 8,
                                                          border: "1px solid " + T.border1,
                                                          background: draft.ankiInRotation ? (T.statusGoodBg || T.inputBg) : T.inputBg,
                                                          color: draft.ankiInRotation ? T.statusGood : T.text2,
                                                          cursor: "pointer",
                                                        }}
                                                      >
                                                        {draft.ankiInRotation ? "✓ Yes" : "○ No"}
                                                      </button>
                                                    </div>

                                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                      <span style={{ fontFamily: MONO, fontSize: 11, color: T.text3 }}>Confidence:</span>
                                                      {[
                                                        { v: "good", label: "✓ Good", color: T.statusGood },
                                                        { v: "okay", label: "△ Okay", color: T.statusWarn },
                                                        { v: "struggling", label: "⚠ Struggling", color: T.statusBad },
                                                      ].map((opt) => {
                                                        const active = draft.confidenceRating === opt.v;
                                                        return (
                                                          <button
                                                            key={opt.v}
                                                            type="button"
                                                            onClick={() =>
                                                              setCompletionDrafts((prev) => ({
                                                                ...(prev || {}),
                                                                [cKey]: { ...draft, confidenceRating: opt.v },
                                                              }))
                                                            }
                                                            style={{
                                                              fontFamily: MONO,
                                                              fontSize: 11,
                                                              padding: "4px 10px",
                                                              borderRadius: 8,
                                                              border: "1px solid " + (active ? opt.color : T.border1),
                                                              background: active ? opt.color + "18" : T.inputBg,
                                                              color: active ? opt.color : T.text2,
                                                              cursor: "pointer",
                                                            }}
                                                          >
                                                            {opt.label}
                                                          </button>
                                                        );
                                                      })}
                                                    </div>

                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        markLectureComplete(task.lec.id, bid, todayStr(), draft.confidenceRating, draft.ankiInRotation, examDate);
                                                        setCompletionDrafts((prev) => ({ ...(prev || {}), [cKey]: null }));
                                                      }}
                                                      style={{
                                                        background: tc,
                                                        border: "none",
                                                        color: "#fff",
                                                        padding: "6px 12px",
                                                        borderRadius: 8,
                                                        cursor: "pointer",
                                                        fontFamily: MONO,
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                      }}
                                                    >
                                                      Confirm ✓
                                                    </button>
                                                  </>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        }

                                        return (
                                          <div style={{ marginTop: 10, marginBottom: 10 }}>
                                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                              <span style={{ fontFamily: MONO, fontSize: 12, color: T.statusGood, fontWeight: 700 }}>
                                                ✓ Completed {completedLabel}
                                              </span>
                                              <span style={{ fontFamily: MONO, fontSize: 11, color: T.text2 }}>
                                                Anki: {c.ankiInRotation ? "✓ in rotation" : "○ not in rotation"}
                                              </span>
                                              <span style={{ fontFamily: MONO, fontSize: 11, color: T.text2 }}>
                                                Next review:{" "}
                                                {nextReview
                                                  ? new Date(nextReview + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                                                  : "—"}
                                              </span>
                                              {(task.matchReason === "🔁 REVIEW DUE" || task.matchReason === "📅 WEEKLY SWEEP") && (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const tid = task.lec.id;
                                                    const tbid = task.lec.blockId || bid;
                                                    console.log("[rxt Mark reviewed today] schedule row", tid, tbid);
                                                    markLectureReviewedToday(tid, tbid, "okay", examDate);
                                                  }}
                                                  style={{
                                                    fontFamily: MONO,
                                                    fontSize: 10,
                                                    padding: "5px 10px",
                                                    borderRadius: 8,
                                                    border: "1px solid " + T.border1,
                                                    background: T.inputBg,
                                                    color: T.text2,
                                                    cursor: "pointer",
                                                  }}
                                                >
                                                  ✓ Mark reviewed today
                                                </button>
                                              )}
                                            </div>
                                            {reviewDates.length > 0 && (
                                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                                                {reviewDates.map(dot)}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}

                                      {(task.recommendedSessions || []).map((rec, ri) => (
                                        <div
                                          key={ri}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 10,
                                            padding: "8px 10px",
                                            marginTop: 8,
                                            borderRadius: 7,
                                            background: T.inputBg,
                                            border: "1px solid " + T.border1,
                                          }}
                                        >
                                          <span
                                            style={{
                                              fontFamily: MONO,
                                              color: T.text1,
                                              fontSize: 11,
                                              fontWeight: 700,
                                              flex: 1,
                                            }}
                                          >
                                            {rec.label}
                                          </span>
                                          <span
                                            style={{
                                              fontFamily: MONO,
                                              color: T.text3,
                                              fontSize: 10,
                                            }}
                                          >
                                            {rec.reason}
                                          </span>
                                          <span
                                            style={{
                                              fontFamily: MONO,
                                              color: T.text3,
                                              fontSize: 10,
                                              flexShrink: 0,
                                            }}
                                          >
                                            ~{rec.duration}m
                                          </span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (rec.type === "deepLearn" && handleDeepLearnStart) {
                                                handleDeepLearnStart({
                                                  selectedTopics: [
                                                    {
                                                      id: task.lec.id + "_full",
                                                      label: task.lec.lectureTitle,
                                                      lecId: task.lec.id,
                                                      weak: false,
                                                    },
                                                  ],
                                                  blockId: bid,
                                                });
                                              } else if (rec.type === "quiz" && startObjectiveQuiz) {
                                                const objs =
                                                  (getBlockObjectives(bid) || []).filter(
                                                    (o) => o.linkedLecId === task.lec.id
                                                  );
                                                const weakObjs =
                                                  task.struggling > 0
                                                    ? objs.filter(
                                                        (o) =>
                                                          o.status === "struggling" ||
                                                          o.status === "untested"
                                                      )
                                                    : objs;
                                                startObjectiveQuiz(
                                                  weakObjs,
                                                  task.lec.lectureTitle || task.lec.fileName,
                                                  bid,
                                                  { lectureId: task.lec.id }
                                                );
                                              } else if (rec.type === "anki" && setAnkiLogTarget) {
                                                setAnkiLogTarget(task.lec);
                                              }
                                            }}
                                            style={{
                                              background: tc,
                                              border: "none",
                                              color: "#fff",
                                              padding: "5px 12px",
                                              borderRadius: 6,
                                              cursor: "pointer",
                                              fontFamily: MONO,
                                              fontSize: 10,
                                              fontWeight: 700,
                                              flexShrink: 0,
                                            }}
                                          >
                                            Start →
                                          </button>
                                        </div>
                                      ))}

                                      {/* Quick log inline — Mark done / Logged today */}
                                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid " + T.border2 }}>
                                        {!loggedToday && !quickOpen && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const tid = task.lec.id;
                                              const tbid = task.lec.blockId || bid;
                                              console.log("[rxt ✓ Mark done] schedule quick-log open", tid, tbid);
                                              setQuickLogState((p) => ({ ...(p || {}), [tid]: { open: true, submitting: false } }));
                                              setQuickLogDraft((p) => ({ ...(p || {}), [tid]: { activityType: "review", confidenceRating: "okay", note: "" } }));
                                              setQuickLogNoteOpen((p) => ({ ...(p || {}), [tid]: false }));
                                            }}
                                            style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid " + T.border1, background: T.inputBg, color: T.text2, cursor: "pointer" }}
                                          >
                                            ✓ Mark done
                                          </button>
                                        )}
                                        {loggedToday && !quickOpen && (
                                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                            <span style={{ fontFamily: MONO, fontSize: 11, color: T.statusGood }}>✓ Logged today — {todaySummary ? (mapActivityIcon(todaySummary.activityType) + " ") : ""}{todaySummary?.confidenceRating === "good" ? "✓ Good" : todaySummary?.confidenceRating === "struggling" ? "⚠ Struggling" : "△ Okay"}</span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setQuickLogState((p) => ({ ...(p || {}), [task.lec.id]: { open: true, submitting: false } }));
                                                setQuickLogDraft((p) => ({ ...(p || {}), [task.lec.id]: { activityType: "review", confidenceRating: "okay", note: "" } }));
                                                setQuickLogNoteOpen((p) => ({ ...(p || {}), [task.lec.id]: false }));
                                              }}
                                              style={{ fontFamily: MONO, fontSize: 10, border: "none", background: "none", color: T.statusProgress, cursor: "pointer", textDecoration: "underline" }}
                                            >
                                              + Log another
                                            </button>
                                          </div>
                                        )}
                                        {quickOpen && (
                                          <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6 }}>
                                            <div style={{ fontFamily: MONO, fontSize: 10, color: T.text3, marginBottom: 6 }}>Activity type</div>
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                                              {[
                                                { v: "deep_learn", label: "🧠 Deep Learn" },
                                                { v: "review", label: "📖 Review" },
                                                { v: "anki", label: "🗂 Anki" },
                                                { v: "questions", label: "❓ Questions" },
                                                { v: "notes", label: "📝 Notes" },
                                                { v: "sg_tbl", label: "👥 SG/TBL" },
                                              ].map((opt) => {
                                                const active = draft.activityType === opt.v;
                                                const accent = T.accent || T.statusProgress;
                                                return (
                                                  <button
                                                    key={opt.v}
                                                    type="button"
                                                    onClick={() => setQuickLogDraft((p) => ({ ...(p || {}), [task.lec.id]: { ...draft, activityType: opt.v } }))}
                                                    style={{
                                                      fontFamily: MONO,
                                                      fontSize: 11,
                                                      padding: "4px 10px",
                                                      borderRadius: 20,
                                                      border: "1px solid " + (active ? accent : T.border1),
                                                      background: active ? accent : "transparent",
                                                      color: active ? "#fff" : (T.textSecondary || T.text2),
                                                      cursor: "pointer",
                                                      fontWeight: active ? 600 : 400,
                                                    }}
                                                  >
                                                    {opt.label}
                                                  </button>
                                                );
                                              })}
                                            </div>
                                            <div style={{ fontFamily: MONO, fontSize: 10, color: T.text3, marginBottom: 6 }}>How did it go?</div>
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                                              {[
                                                { v: "good", label: "✓ Good", color: T.statusGood },
                                                { v: "okay", label: "△ Okay", color: T.statusWarn },
                                                { v: "struggling", label: "⚠ Struggling", color: T.statusBad },
                                              ].map((opt) => (
                                                <button
                                                  key={opt.v}
                                                  type="button"
                                                  onClick={() => setQuickLogDraft((p) => ({ ...(p || {}), [task.lec.id]: { ...draft, confidenceRating: opt.v } }))}
                                                  style={{ fontFamily: MONO, fontSize: 10, padding: "4px 8px", borderRadius: 8, border: "1px solid " + (draft.confidenceRating === opt.v ? opt.color : T.border1), background: draft.confidenceRating === opt.v ? (opt.color + "18") : T.cardBg, color: draft.confidenceRating === opt.v ? opt.color : T.text2, cursor: "pointer" }}
                                                >
                                                  {opt.label}
                                                </button>
                                              ))}
                                            </div>
                                            {quickLogNoteOpen[task.lec.id] ? (
                                              <input
                                                type="text"
                                                placeholder="Quick note (optional)"
                                                value={draft.note || ""}
                                                onChange={(e) => setQuickLogDraft((p) => ({ ...(p || {}), [task.lec.id]: { ...draft, note: e.target.value } }))}
                                                style={{ width: "100%", marginBottom: 8, padding: "6px 10px", border: "1px solid " + T.border1, borderRadius: 8, fontFamily: MONO, fontSize: 11, background: T.cardBg, color: T.text1 }}
                                              />
                                            ) : (
                                              <button type="button" onClick={() => setQuickLogNoteOpen((p) => ({ ...(p || {}), [task.lec.id]: true }))} style={{ fontFamily: MONO, fontSize: 10, border: "none", background: "none", color: T.text3, cursor: "pointer", marginBottom: 8, textDecoration: "underline" }}>+ add note</button>
                                            )}
                                            <button
                                              type="button"
                                              disabled={quickSubmitting}
                                              onClick={() => {
                                                setQuickLogState((p) => ({ ...(p || {}), [task.lec.id]: { ...(p || {})[task.lec.id], submitting: true } }));
                                                const conf = draft.confidenceRating || "okay";
                                                logActivity(task.lec.id, task.lec.blockId || bid, draft.activityType || "review", conf, { note: draft.note || null, date: todayKeyInner, examDate: examDate || null });
                                                setQuickLogState((p) => ({ ...(p || {}), [task.lec.id]: { open: false, submitting: false } }));
                                                setQuickLogDraft((p) => ({ ...(p || {}), [task.lec.id]: undefined }));
                                                setQuickLogNoteOpen((p) => ({ ...(p || {}), [task.lec.id]: false }));
                                                refreshAllData();
                                                if (conf === "struggling") {
                                                  setFlashTaskId({ lecId: task.lec.id, color: T.statusBad });
                                                  setTimeout(() => setFlashTaskId(null), 600);
                                                } else if (conf === "good") {
                                                  setFlashTaskId({ lecId: task.lec.id, color: T.statusGood });
                                                  setTimeout(() => setFlashTaskId(null), 600);
                                                }
                                              }}
                                              style={{ fontFamily: MONO, fontSize: 11, padding: "6px 12px", borderRadius: 8, border: "none", background: T.statusProgress, color: "#fff", cursor: quickSubmitting ? "default" : "pointer", fontWeight: 700 }}
                                            >
                                              {quickSubmitting ? "Saving…" : "Save"}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            });
                            })()}
                                </>
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "4px 0",
                                    marginBottom: 0,
                                  }}
                                >
                                  <span style={{ fontFamily: MONO, fontWeight: 900, fontSize: 12, color: T.text2 }}>
                                    {day.dayLabel}
                                  </span>
                                  <span style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>{day.dateStr}</span>
                                  <div style={{ flex: 1, height: 1, background: T.border2 }} />
                                </div>
                              )}
                          </div>
                        );
                      });
                    })()}

                  {result?.upcoming?.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 10,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: MONO,
                            color: T.text3,
                            fontSize: 9,
                            letterSpacing: 1.5,
                          }}
                        >
                          UPCOMING
                        </div>
                        <div
                          style={{ flex: 1, height: 1, background: T.border2 }}
                        />
                      </div>
                      {result.upcoming.map((ls) => (
                        <div
                          key={ls.lec.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 14px",
                            borderRadius: 8,
                            marginBottom: 6,
                            opacity: 0.65,
                            background: T.inputBg,
                            border: "1px solid " + T.border1,
                          }}
                        >
                          {lecTypeBadge &&
                            lecTypeBadge(ls.lec.lectureType || "LEC")}
                          <span
                            style={{
                              fontFamily: MONO,
                              color: T.text2,
                              fontSize: 11,
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {ls.lec.lectureTitle || ls.lec.fileName}
                          </span>
                          <span
                            style={{
                              fontFamily: MONO,
                              color: T.text3,
                              fontSize: 10,
                              flexShrink: 0,
                            }}
                          >
                            {ls.daysUntilAvailable === 0
                              ? "Today"
                              : ls.daysUntilAvailable === 1
                                ? "Tomorrow"
                                : `in ${ls.daysUntilAvailable}d`}
                            {" · "}
                            {ls.availableDate.toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {examDate && daysLeft >= 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 16px",
                        borderRadius: 10,
                        background: T.statusBadBg,
                        border: "2px solid " + T.statusBadBorder,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>🎯</span>
                      <div>
                        <div
                          style={{
                            fontFamily: SERIF,
                            color: T.statusBad,
                            fontSize: 14,
                            fontWeight: 900,
                          }}
                        >
                          EXAM DAY
                        </div>
                        <div
                          style={{
                            fontFamily: MONO,
                            color: T.text3,
                            fontSize: 11,
                          }}
                        >
                          {new Date(examDate).toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })())}

            {/* Calendar tab (Step A): existing exam date selector (unchanged) */}
            {activeTab === "calendar" && (() => {
              const blockId = trackerBlockId || activeBlock?.id;
              const block = blockId
                ? Object.values(blocks || {}).find((b) => b.id === blockId)
                : Object.values(blocks || {})[0];
              const bid = block?.id || blockId;
              if (!bid) return null;

              const examDate = examDates[bid] || "";
              return (
                <CalendarTabContent
                  blockId={bid}
                  examDate={examDate}
                  // keep existing onChange handler exactly as-is
                  examDateInputOnChange={(e) => saveExamDate && saveExamDate(bid, e.target.value)}
                  completion={completion}
                  lecs={lecs}
                  getPressureZone={getPressureZone}
                  logActivity={logActivity}
                  refreshAllData={refreshAllData}
                  refreshKey={refreshKey}
                  theme={t}
                  MONO={MONO}
                />
              );
            })()}

            {activeTab === "weakConcepts" && weakConceptsTabContent && (
              <div style={{ padding: "16px 24px", maxWidth: 960, margin: "0 auto", width: "100%" }}>
                {weakConceptsTabContent}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── ANALYTICS ────────────────────────────────── */}
      {tab==="analytics" && (
        <div style={{ flex:1, padding:"24px 20px", overflowY:"auto" }}>
          <h2 style={{ fontFamily:SERIF, fontSize:24, fontWeight:900, letterSpacing:-0.5, marginBottom:20 }}>
            Grade <span style={{ color:t.statusBad }}>Analytics</span>
          </h2>
          <Analytics rows={rows} />
        </div>
      )}

      {showAdd && <AddModal onAdd={addRow} onClose={()=>setShowAdd(false)} />}
    </div>
  );
}
