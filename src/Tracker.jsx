import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTheme, getScoreColor, getUrgencyColor, URGENCY_LABELS } from "./theme";
import { recordWrongAnswer } from "./weakConcepts";

// ── Storage ───────────────────────────────────────────────
function sGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function sSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ── Constants ─────────────────────────────────────────────
const MONO  = "'DM Mono','Courier New',monospace";
const SERIF = "'Playfair Display',Georgia,serif";

const BLOCKS = ["FTM 1","FTM 2","MSK","CPR 1","CPR 2"];
const BLOCK_COLORS = {
  "FTM 1":"#ef4444","FTM 2":"#f59e0b",
  "MSK":"#10b981","CPR 1":"#3b82f6","CPR 2":"#a78bfa"
};

// Confidence scale — drives how often a subject should be reviewed
const CONFIDENCE = [
  { value:1, label:"No Clue",    color:"#ef4444", bg:"#150404", border:"#450a0a", reviewDays:1  },
  { value:2, label:"Struggling", color:"#f97316", bg:"#160800", border:"#431407", reviewDays:2  },
  { value:3, label:"Shaky",      color:"#f59e0b", bg:"#160e00", border:"#451a03", reviewDays:3  },
  { value:4, label:"Getting It", color:"#84cc16", bg:"#0c1400", border:"#1a2e05", reviewDays:5  },
  { value:5, label:"Solid",      color:"#10b981", bg:"#021710", border:"#064e3b", reviewDays:7  },
  { value:6, label:"Mastered",   color:"#06b6d4", bg:"#021419", border:"#0e4f5e", reviewDays:14 },
];

const STEPS = [
  { key:"preRead",    label:"Pre-Read",     icon:"📖", color:"#60a5fa" },
  { key:"lecture",    label:"Lecture",      icon:"🎓", color:"#f59e0b" },
  { key:"postReview", label:"Post-Review",  icon:"📝", color:"#a78bfa" },
  { key:"anki",       label:"Anki Cards",   icon:"🃏", color:"#10b981" },
];

const checkColors = ["#60a5fa", "#f59e0b", "#a78bfa", "#6b7280"];

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().slice(0, 10);
    const todayISO = new Date(today).toISOString();

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

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
        .filter((d) => d < today)
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
        .filter((x) => x.dt < today)
        .sort((a, b) => a.dt - b.dt);
      const earliest = overdue[0]?.raw || todayStr;
      const daysOverdue = Math.ceil((today - new Date(earliest)) / (1000 * 60 * 60 * 24));
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

function Check({ checked, onClick, color }) {
  const { T } = useTheme();
  return (
    <div onClick={onClick} style={{
      width:24, height:24, borderRadius:6,
      border:"1.5px solid "+(checked ? color : T.border1),
      background: checked ? color+"28" : "transparent",
      display:"flex", alignItems:"center", justifyContent:"center",
      cursor:"pointer", transition:"all 0.15s", margin:"0 auto", flexShrink:0,
    }}>
      {checked && <span style={{ color, fontSize:14, fontWeight:700, lineHeight:1 }}>✓</span>}
    </div>
  );
}

function DaysBadge({ lastStudied, confidence }) {
  const { T, isDark } = useTheme();
  const days = daysSince(lastStudied);
  const urg  = getUrgency(confidence, lastStudied);
  const u    = URG[urg];
  if (days === null) return <span style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>—</span>;
  const pillBg = u.label ? (isDark ? u.color+"18" : u.color+"26") : "transparent";
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
      <span style={{ fontFamily:MONO, color:u.color, fontSize:17, fontWeight:700, lineHeight:1, textShadow:u.glow }}>{days}d</span>
      {u.label && <span style={{ fontFamily:MONO, color:u.color, fontSize:13, letterSpacing:1, background:pillBg, padding:"1px 5px", borderRadius:3 }}>{u.label}</span>}
    </div>
  );
}

function ScoreCell({ scores, onAdd, onClear }) {
  const [val, setVal] = useState("");
  const { T, isDark } = useTheme();
  const submit = () => {
    const n = Number(val);
    if (!val || isNaN(n) || n < 0 || n > 100) return;
    onAdd(n); setVal("");
  };
  const a = avg(scores);
  const col = a===null?T.text4:a>=80?T.green:a>=70?T.amber:a>=60?T.amber:T.red;
  const badgeBg = isDark ? col+"18" : col+"26";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      {a !== null && (
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontFamily:MONO, color:col, fontSize:16, fontWeight:700 }}>{a}%</span>
          <span style={{ fontFamily:MONO, color:col, background:badgeBg, fontSize:13, padding:"1px 5px", borderRadius:3 }}>×{scores.length}</span>
          <button onClick={onClear} style={{ background:"none", border:"none", color:T.text4, cursor:"pointer", fontSize:13 }} title="Clear">✕</button>
        </div>
      )}
      <div style={{ display:"flex", gap:3 }}>
        <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}
          placeholder="%" type="number" min={0} max={100}
          style={{ width:44, background:T.inputBg, border:"1px solid "+T.border1, color:T.text1, padding:"3px 5px", borderRadius:4, fontFamily:MONO, fontSize:14, outline:"none" }} />
        <button onClick={submit} style={{ background:T.border1, border:"none", color:T.blue, padding:"3px 7px", borderRadius:4, cursor:"pointer", fontFamily:MONO, fontSize:13 }}>+</button>
      </div>
    </div>
  );
}

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

// Inline-editable text cell
function EditCell({ value, onChange, placeholder, type }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value || "");
  const ref = useRef();
  const { T, isDark } = useTheme();
  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  const commit = () => { setEditing(false); if (draft !== (value||"")) onChange(draft); };

  if (type === "date") {
    return (
      <input
        type="date"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        style={dateInputStyle(T, isDark)}
        title="Click to open calendar"
      />
    );
  }
  return editing ? (
    <input ref={ref} value={draft} onChange={e=>setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(); if(e.key==="Escape"){ setDraft(value||""); setEditing(false); } }}
      style={{ background:T.inputBg, border:"1px solid "+T.blue, color:T.text1, fontFamily:MONO, fontSize:13, padding:"2px 6px", borderRadius:4, outline:"none", width:"100%" }} />
  ) : (
    <div onClick={() => setEditing(true)}
      title="Click to edit"
      style={{ color:value?T.text2:T.text5, fontFamily:MONO, fontSize:13, cursor:"text", padding:"2px 4px", borderRadius:4,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", transition:"background 0.1s" }}
      onMouseEnter={e=>e.currentTarget.style.background=T.rowHover}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      {value || placeholder || "—"}
    </div>
  );
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
        borderRadius:6, border:"1px solid "+(conf?(isDark?conf.color+"40":conf.color):T.border1),
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
              padding: "3px 10px",
              borderRadius: 20,
              border: "0.5px solid",
              cursor: "pointer",
              background: activityType === at.key ? (t.statusProgress + "22") : "transparent",
              color: activityType === at.key ? t.statusProgress : t.text2,
              borderColor: activityType === at.key ? t.statusProgress : t.border1,
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
// SINGLE TABLE ROW
// ─────────────────────────────────────────────────────────
const GRID = "20px 58px 110px 1fr 92px 92px 58px 26px 26px 26px 26px 92px 112px 70px 160px 20px";

function TrackerRow({ row, upd, delRow, addScore, clrScore, expanded, setExpanded, flashLastStudied, index, isDark }) {
  const { T } = useTheme();
  const bc      = BLOCK_COLORS[row.block] || T.text4;
  const allDone = row.preRead && row.lecture && row.postReview && row.anki;
  const urg     = getUrgency(row.confidence, row.lastStudied);
  const u       = URG[urg];
  const isOpen  = expanded[row.id];
  const conf    = row.confidence ? getConf(row.confidence) : null;
  const todayStr = () => new Date().toISOString().split("T")[0];

  const rowIndex = index != null ? index : 0;
  const rowBg = urg==="critical" ? (isDark?u.bg:T.redBg) : urg==="overdue" ? (isDark?u.bg:T.amberBg) : allDone ? (isDark?T.greenBg:T.greenBg) : (isDark?"transparent":(rowIndex%2===0?T.hoverBg:T.cardBg));
  const leftBorder= urg==="critical" ? T.red : urg==="overdue" ? T.amber : "transparent";
  const rowGlow = (urg==="critical"||urg==="overdue") ? (isDark ? u.glow : (urg==="critical" ? "0 0 14px #ef444426" : "0 0 8px #f9731626")) : "none";

  return (
    <div style={{ borderBottom:"1px solid " + T.border2 }}>
      <div
        style={{ display:"grid", gridTemplateColumns:GRID, gap:6, padding:"9px 16px", alignItems:"center",
          background:rowBg, borderLeft:"3px solid "+leftBorder, transition:"background 0.2s",
          boxShadow:rowGlow }}
        onMouseEnter={e=>{ if(urg==="none"&&!allDone) e.currentTarget.style.background=T.rowHover; }}
        onMouseLeave={e=>{ e.currentTarget.style.background=rowBg; }}>

        {/* Expand toggle */}
        <button onClick={()=>setExpanded(p=>({...p,[row.id]:!p[row.id]}))}
          style={{ background:"none", border:"none", color:T.text5, cursor:"pointer", fontSize:13, padding:0, lineHeight:1, textAlign:"center" }}>
          {isOpen?"▾":"▸"}
        </button>

        {/* Block selector */}
        <select value={row.block} onChange={e=>upd(row.id,{block:e.target.value})}
          style={{ background:"transparent", border:"none", color:bc, fontFamily:MONO, fontSize:13, cursor:"pointer", outline:"none", width:"100%" }}>
          {BLOCKS.map(b=><option key={b} style={{ background:T.cardBg, color:BLOCK_COLORS[b]||T.text1 }}>{b}</option>)}
        </select>

        {/* Subject — inline edit */}
        <EditCell value={row.subject} onChange={v=>upd(row.id,{subject:v})} placeholder="Subject…" />

        {/* Topic — inline edit + AUTO badge if synced from session or auto-generated */}
        <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
        <EditCell value={row.topic} onChange={v=>upd(row.id,{topic:v})} placeholder="Lecture / topic…" />
          {(row.autoGenerated || (row.reps > 0 && row.lecture && !row.lectureDate)) && (
            <span style={{ fontFamily:MONO, fontSize:8, color:T.blue, background:T.blue+"18", padding:"1px 5px", borderRadius:3, border:"1px solid "+T.blue+"40", flexShrink:0 }}>AUTO</span>
          )}
        </div>

        {/* Lecture date */}
        <EditCell value={row.lectureDate} onChange={v=>upd(row.id,{lectureDate:v})} type="date" />

        {/* Last studied */}
        <div style={{ transition:"background 0.3s ease", background:flashLastStudied?T.greenBg:"transparent", borderRadius:6 }}>
        <EditCell value={row.lastStudied} onChange={v=>upd(row.id,{lastStudied:v})} type="date" />
        </div>

        {/* Days since */}
        <DaysBadge lastStudied={row.lastStudied} confidence={row.confidence} />

        {/* Step checkboxes — ticking any = studied today */}
        {STEPS.map(s=>(
          <Check key={s.key} checked={row[s.key]} onClick={()=>upd(row.id,{[s.key]:!row[s.key],lastStudied:todayStr()})} color={s.color} />
        ))}

        {/* Anki date */}
        <EditCell value={row.ankiDate} onChange={v=>upd(row.id,{ankiDate:v})} type="date" />

        {/* Confidence picker */}
        <ConfPicker value={row.confidence} onChange={v=>upd(row.id,{confidence:v})} />

        {/* Sessions */}
        <div style={{ fontFamily:MONO, fontSize:13, color:T.text2 }}>{(row.reps||0) ? (row.reps||0) + " session" + ((row.reps||0)!==1?"s":"") : "—"}</div>

        {/* Score input */}
        <ScoreCell scores={row.scores} onAdd={sc=>addScore(row.id,sc)} onClear={()=>clrScore(row.id)} />

        {/* Delete */}
        <button onClick={()=>delRow(row.id)}
          style={{ background:"none", border:"none", color:T.border1, cursor:"pointer", fontSize:13, padding:2 }}
          onMouseEnter={e=>e.currentTarget.style.color=T.red}
          onMouseLeave={e=>e.currentTarget.style.color=T.border1}>✕</button>
      </div>

      {/* Expanded section */}
      {isOpen && (
        <div style={{ padding:"10px 16px 14px 46px", background:T.sidebarBg, borderTop:"1px solid " + T.border2 }}>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:10, alignItems:"center" }}>
            {conf && (
              <div style={{ display:"flex", alignItems:"center", gap:8, background:isDark?conf.bg:conf.color+"26", border:"1px solid "+conf.color, borderRadius:8, padding:"6px 14px" }}>
                <div style={{ width:10,height:10,borderRadius:"50%",background:conf.color }}/>
                <span style={{ fontFamily:MONO, color:conf.color, fontSize:13, fontWeight:600 }}>{conf.label}</span>
                <span style={{ fontFamily:MONO, color:T.text4, fontSize:13 }}>· review every {conf.reviewDays} days</span>
              </div>
            )}
            {row.scores.length > 0 && (
              <div style={{ display:"flex", gap:5, alignItems:"center", flexWrap:"wrap" }}>
                <span style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>Score log:</span>
                {row.scores.map((sc,i)=>{ const c=sc>=80?T.green:sc>=70?T.amber:sc>=60?T.amber:T.red; return <span key={i} style={{ fontFamily:MONO,color:c,background:isDark?c+"18":c+"26",fontSize:16,fontWeight:700,padding:"1px 7px",borderRadius:4 }}>{sc}%</span>; })}
              </div>
            )}
            {row.scores.length > 1 && (
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>Trend:</span>
                <div style={{ display:"flex", gap:2 }}>
                  {row.scores.map((sc,i)=>(
                    <span key={i} style={{ width:8, height:8, borderRadius:2, background: sc>=70?T.green:sc>=60?T.amber:T.red, flexShrink:0 }} title={sc+"%"} />
                  ))}
          </div>
              </div>
            )}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <div style={{ fontFamily:MONO, color:T.text5, fontSize:13, letterSpacing:1.5 }}>NOTES / HIGH-YIELD POINTS</div>
            <button type="button" onClick={()=>upd(row.id,{lastStudied:todayStr()})}
              style={{ fontFamily:MONO, fontSize:13, color:T.green, background:T.greenBg, border:"1px solid "+T.greenBorder, borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>
              Mark Studied Today
            </button>
          </div>
          <textarea value={row.notes} onChange={e=>upd(row.id,{notes:e.target.value})}
            placeholder="Mnemonics, First Aid pages, weak areas, connections to revisit…" rows={2}
            style={{ width:"100%", maxWidth:740, background:T.inputBg, border:"1px solid " + T.border1, color:T.text2,
              padding:"8px 12px", borderRadius:8, fontFamily:MONO, fontSize:13, outline:"none", lineHeight:1.6, resize:"vertical" }} />
        </div>
      )}
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
    setSearchQuery("");
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
                    const confScore = entry?.lastConfidence === "good" ? 3 : entry?.lastConfidence === "okay" ? 2 : entry?.lastConfidence === "struggling" ? 1 : 0;
                    const confBarColor = entry?.lastConfidence === "good" ? "#639922" : entry?.lastConfidence === "okay" ? "#BA7517" : entry?.lastConfidence === "struggling" ? "#E24B4A" : "transparent";
                    const trendColor = confidenceTrend.trend === "improving" ? "#639922" : confidenceTrend.trend === "declining" || confidenceTrend.trend === "stuck" ? "#E24B4A" : confidenceTrend.arrow ? "#BA7517" : t.text3;
                    const dotColor = entry?.lastConfidence === "good" ? "#639922" : entry?.lastConfidence === "okay" ? "#BA7517" : entry?.lastConfidence === "struggling" ? "#E24B4A" : null;
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
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 12px",
                            borderBottom: "0.5px solid " + t.border2,
                            cursor: "pointer",
                            transition: "background 0.15s",
                            background: isExpanded ? t.inputBg : undefined,
                            borderLeft: isExpanded ? "3px solid #0891b2" : undefined,
                          }}
                          onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = t.inputBg; }}
                          onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = ""; }}
                        >
                          <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3, minWidth: 40, flexShrink: 0 }}>{(lec.lectureType || "LEC").toUpperCase()} {lec.lectureNumber ?? ""}</span>
                          <span style={{ flex: 1, fontSize: 13, color: t.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{title}</span>
                          <div style={{ width: 48, height: 5, borderRadius: 3, background: t.border2, flexShrink: 0, overflow: "hidden" }}>
                            <div style={{ width: `${(confScore / 3) * 100}%`, height: "100%", background: confBarColor, borderRadius: 3 }} />
                          </div>
                          <span style={{ flexShrink: 0, fontSize: 13, minWidth: 16, textAlign: "center", color: trendColor }}>{confidenceTrend.arrow ?? "—"}</span>
                          <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 11, color: t.text3, minWidth: 28, textAlign: "right" }}>{interactionCount}x</span>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: dotColor || "transparent", border: dotColor ? "none" : "1px solid " + t.border2 }} />
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
                                      <button type="button" onClick={() => setReviewFlowByLec((p) => ({ ...(p || {}), [lec.id]: { open: true, confidenceRating: "okay", date: todayISO } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: t.statusProgress, color: "#fff", cursor: "pointer", fontWeight: 900 }}>🔁 Log Review</button>
                                      <button type="button" onClick={() => setActivityFlowByLec((p) => ({ ...(p || {}), [lec.id]: { open: true, date: todayISO, activityType: "review", confidenceRating: "okay", durationMinutes: "", note: "" } }))} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid " + t.border1, background: t.cardBg, color: t.text2, cursor: "pointer", fontWeight: 900 }}>＋ Log Activity</button>
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
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                                              {[{ v: "review", label: "📖 Review" }, { v: "anki", label: "🃏 Anki" }, { v: "questions", label: "❓ Questions" }, { v: "notes", label: "📝 Notes" }, { v: "sg_tbl", label: "👥 SG/TBL" }, { v: "manual", label: "✏️ Other" }].map((opt) => {
                                                const active = flow.activityType === opt.v;
                                                return <button key={opt.v} type="button" onClick={() => setFlow({ activityType: opt.v })} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 999, border: "1px solid " + (active ? t.statusProgress : t.border1), background: active ? (t.statusProgressBg || (t.statusProgress + "18")) : t.cardBg, color: active ? t.statusProgress : t.text2, cursor: "pointer", fontWeight: 900 }}>{opt.label}</button>;
                                              })}
                                            </div>
                                            <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, marginBottom: 8 }}>How did it go?</div>
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                                              {[{ v: "good", label: "✓ Good", color: t.statusGood }, { v: "okay", label: "△ Okay", color: t.statusWarn }, { v: "struggling", label: "⚠ Struggling", color: t.statusBad }].map((opt) => {
                                                const active = flow.confidenceRating === opt.v;
                                                return <button key={opt.v} type="button" onClick={() => setFlow({ confidenceRating: opt.v })} style={{ fontFamily: MONO, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid " + (active ? opt.color : t.border1), background: active ? opt.color + "18" : t.cardBg, color: active ? opt.color : t.text2, cursor: "pointer", fontWeight: 900 }}>{opt.label}</button>;
                                              })}
                                            </div>
                                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                                              <input value={flow.durationMinutes ?? ""} onChange={(e) => setFlow({ durationMinutes: e.target.value })} placeholder="Duration (min)" style={{ width: 140, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                              {flow.activityType === "anki" && <input value={flow.ankiOverdueCount ?? ""} onChange={(e) => setFlow({ ankiOverdueCount: e.target.value })} placeholder="Update overdue? (cards)" style={{ width: 190, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />}
                                              <input value={flow.note ?? ""} onChange={(e) => setFlow({ note: e.target.value })} placeholder="Note (optional)" style={{ flex: 1, minWidth: 200, background: t.cardBg, border: "1px solid " + t.border1, borderRadius: 8, padding: "6px 10px", color: t.text1, fontFamily: MONO, fontSize: 11 }} />
                                            </div>
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                              <button type="button" onClick={() => { const dur = flow.durationMinutes != null && String(flow.durationMinutes).trim() !== "" ? parseInt(String(flow.durationMinutes), 10) : null; logActivity(lec.id, bid, flow.activityType, flow.confidenceRating, { durationMinutes: Number.isNaN(dur) ? null : dur, note: flow.note ? String(flow.note).trim() : null, date: selectedDate, examDate: examDateForBlock }); if (flow.activityType === "anki" && String(flow.ankiOverdueCount || "").trim() !== "") { const oc = parseInt(String(flow.ankiOverdueCount), 10); if (!Number.isNaN(oc)) updateAnkiCounts(lec.id, bid, null, oc); } setActivityFlowByLec((p) => ({ ...(p || {}), [lec.id]: null })); }} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "none", background: t.statusGood, color: "#fff", cursor: "pointer", fontWeight: 900 }}>Save ✓</button>
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

// Calendar tab content — extracted so hooks run only when tab is active
function CalendarTabContent({
  blockId: bid,
  examDate,
  examDateInputOnChange, // must be the exact handler passed from Tracker
  completion,
  lecs,
  getPressureZone,
  logActivity,
  setRefreshKey,
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

  function buildActivityIndex(completionsIn, blockId) {
    const index = {};
    Object.values(completionsIn || {})
      .filter((e) => e && e.blockId === blockId)
      .forEach((e) => {
        if (!e.activityLog) return;
        e.activityLog.forEach((a) => {
          const day = String(a.date || "").split("T")[0];
          if (!day) return;
          if (!index[day]) index[day] = [];
          index[day].push({
            ...a,
            lectureId: e.lectureId,
            lecTitle: (allLecs.find((l) => l.id === e.lectureId)?.title || allLecs.find((l) => l.id === e.lectureId)?.lectureTitle) || "Unknown lecture",
          });
        });
      });
    return index;
  }

  function buildReviewIndex(completionsIn, blockId) {
    const index = {};
    Object.values(completionsIn || {})
      .filter((e) => e && e.blockId === blockId)
      .forEach((e) => {
        if (!e.reviewDates) return;
        e.reviewDates.forEach((d) => {
          const day = String(d || "").split("T")[0];
          if (!day) return;
          if (!index[day]) index[day] = [];
          index[day].push({
            lectureId: e.lectureId,
            lecTitle: (allLecs.find((l) => l.id === e.lectureId)?.title || allLecs.find((l) => l.id === e.lectureId)?.lectureTitle) || "Unknown",
            lastConfidence: e.lastConfidence,
          });
        });
      });
    return index;
  }

  const activityIndex = buildActivityIndex(completions, bid);
  const reviewIndex = buildReviewIndex(completions, bid);

  function getDayHeat(dateStr, activityIndexIn, reviewIndexIn) {
    const acts = activityIndexIn[dateStr] || [];
    const reviews = reviewIndexIn[dateStr] || [];
    const hasStruggling = acts.some((a) => a.confidenceRating === "struggling");
    const hasOverdue = (() => {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return reviews.length > 0 && d < today && !acts.length;
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

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const todayStr0 = iso(today);
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

  const heatColor = (heat) => {
    if (heat === "scheduled") return "#D3D1C7";
    if (heat === "low") return "#C0DD97";
    if (heat === "medium") return "#639922";
    if (heat === "high") return "#3B6D11";
    if (heat === "overdue") return "#EF9F27";
    if (heat === "struggling") return "#E24B4A";
    return t.border2;
  };

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
  }, [bid, blockLecs.length]);

  const selectedActs = activityIndex[selectedDateStr] || [];
  const selectedReviews = reviewIndex[selectedDateStr] || [];

  const missedForLecture = (lectureId) => {
    const d = new Date(selectedDateStr);
    d.setHours(0, 0, 0, 0);
    if (d >= today) return false;
    return !selectedActs.some((a) => a.lectureId === lectureId);
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
            <button type="button" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); const a = new Date(d); a.setDate(1); setCalendarAnchor(a); setSelectedDate(d); }} style={{ fontFamily: MONO, fontSize: 12, padding: "4px 10px", border: "1px solid " + t.border1, background: t.cardBg, color: t.text2, borderRadius: 8, cursor: "pointer" }}>Today</button>
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
          const hasReviews = (reviewIndex[dateStr] || []).length > 0;
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
              <div style={{ width: "100%", height: 16, borderRadius: 3, background: heat === "empty" ? (t.border2 + "80") : heatColor(heat) }} />
              {hasReviews && (
                <div title={`${(reviewIndex[dateStr] || []).length} review(s) scheduled`} style={{ width: 3, height: 3, borderRadius: 999, background: "#185FA5", marginTop: 2 }} />
              )}
              {examDateStr && dateStr === examDateStr && (
                <div style={{ marginTop: 2, fontSize: 8, color: "#E24B4A", fontFamily: MONO, fontWeight: 900 }}>EXAM</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Heat legend */}
      <div style={{ marginTop: 6, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        {[
          { key: "empty", color: t.border2, label: "No activity" },
          { key: "scheduled", color: "#D3D1C7", label: "Review planned" },
          { key: "low", color: "#C0DD97", label: "1 session" },
          { key: "medium", color: "#639922", label: "2–3 sessions" },
          { key: "high", color: "#3B6D11", label: "4+ sessions" },
          { key: "overdue", color: "#EF9F27", label: "Missed review" },
          { key: "struggling", color: "#E24B4A", label: "Struggled" },
        ].map((it) => (
          <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: it.color }} />
            <div style={{ fontSize: 10, color: t.text3 }}>{it.label}</div>
          </div>
        ))}
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
                  {confPill(a.confidenceRating)}
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
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i === selectedReviews.length - 1 ? "none" : "0.5px solid " + t.border2 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 999, background: "#185FA5" }} />
                  <div style={{ fontSize: 13, color: t.text1, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.lecTitle}</div>
                  {missed ? (
                    <span style={{ fontFamily: MONO, fontSize: 11, color: t.statusBad, fontWeight: 900 }}>⚠ Missed</span>
                  ) : r.lastConfidence ? (
                    confPill(r.lastConfidence)
                  ) : (
                    <span style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>○ First review</span>
                  )}
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
                          setRefreshKey && setRefreshKey((k) => (k || 0) + 1);
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
  const [expanded, setExpanded] = useState({});
  const [flashLastStudiedRowId, setFlashLastStudiedRowId] = useState(null);
  const [showStudyLog, setShowStudyLog] = useState(false);
  const [showNotStarted, setShowNotStarted] = useState(false);
  const [showManualLog, setShowManualLog] = useState(false);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [openStudyLogGroups, setOpenStudyLogGroups] = useState(() => ({}));
  const todayKeyForSchedule = () => new Date().toISOString().split("T")[0];
  const [expandedScheduleDays, setExpandedScheduleDays] = useState(() => {
    const t = new Date().toISOString().split("T")[0];
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
  const [quickLogNoteOpen, setQuickLogNoteOpen] = useState(() => ({})); // { [lecId]: boolean }
  const [quickLogDraft, setQuickLogDraft] = useState(() => ({})); // { [lecId]: { activityType, confidenceRating, note } }
  const [quickLogOpenId, setQuickLogOpenId] = useState(null); // Today tab only (single open at a time)
  /** `${lectureId}__${blockId}` — optional wrong-questions-only panel on done cards */
  const [quickLogWrongOnlyKey, setQuickLogWrongOnlyKey] = useState(null);
  /** Brief flash under ✓ Done after logging weak concepts */
  const [weakConceptFlash, setWeakConceptFlash] = useState(null); // { key: string, count: number } | null
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
  const toggleRow = (rowKey) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };
  const timerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const { T: t, isDark } = useTheme();

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
  }, []);

  // When navigating to Tracker from a block, select that block's tab
  useEffect(() => {
    if (activeBlock?.id) {
      setTrackerBlockId(activeBlock.id);
      if (activeBlock?.name) setFilter(activeBlock.name);
    }
  }, [activeBlock?.id]);

  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener("rxt-completion-updated", handler);
    return () => window.removeEventListener("rxt-completion-updated", handler);
  }, []);

  useEffect(() => {
    setTodayFilter("all");
    setTodaySort("urgency");
    setTodaySearch("");
    setShowNotStarted(false);
  }, [trackerBlockId]);

  // Save (debounced when uncontrolled; parent persists when controlled)
  const persist = (nr) => {
    setSaveMsg("saving");
    clearTimeout(timerRef.current);
    if (isControlled) {
      setSaveMsg("saved");
      setTimeout(() => setSaveMsg(""), 2000);
      return;
    }
    timerRef.current = setTimeout(() => { sSet("rxt-tracker-v2", nr); setSaveMsg("saved"); setTimeout(() => setSaveMsg(""), 2000); }, 500);
  };

  const todayStr = () => new Date().toISOString().split("T")[0];
  const triggerFlash = (id) => {
    setFlashLastStudiedRowId(id);
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashLastStudiedRowId(null), 1500);
  };
  const upd = (id, patch) => {
    setRows(p => { const n = p.map(r => r.id === id ? { ...r, ...patch } : r); persist(n); return n; });
    if (patch.lastStudied !== undefined) triggerFlash(id);
  };
  const addRow   = row        => setRows(p=>{ const n=[...p,row]; persist(n); return n; });
  const delRow   = id         => setRows(p=>{ const n=p.filter(r=>r.id!==id); persist(n); return n; });
  const addScore = (id, sc)   => {
    const today = todayStr();
    setRows(p=>{ const n=p.map(r=>r.id===id?{...r,scores:[...r.scores,sc],lastStudied:today}:r); persist(n); return n; });
    triggerFlash(id);
  };
  const clrScore = id         => setRows(p=>{ const n=p.map(r=>r.id===id?{...r,scores:[]}:r); persist(n); return n; });

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

      return {
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
        },
      };
    });

    // Keep the tracker log rows in sync (best-effort in Tracker)
    const blockName = Object.values(blocks || {}).find((b) => b.id === blockId)?.name || blockId;
    const topic = (lec?.lectureTitle || lec?.fileName || lec?.filename || "").trim() || "Lecture";

    setRows((p) => {
      const idx = (p || []).findIndex((r) => r.lectureId === lectureId);
      if (idx >= 0) {
        const n = (p || []).map((r, i) =>
          i === idx ? { ...r, blockId, block: r.block || blockName, topic: r.topic || topic, lecture: true, lastStudied: dateKey } : r
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

  const markLectureReviewedToday = (lectureId, blockId, confidenceRating = "okay", examDateStr = null) => {
    logActivity(lectureId, blockId, "review", confidenceRating, { date: todayStr(), examDate: examDateStr });
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

  const critCount = rows.filter(r=>getUrgency(r.confidence,r.lastStudied)==="critical").length;
  const ovdCount  = rows.filter(r=>getUrgency(r.confidence,r.lastStudied)==="overdue").length;

  const COL_HEADS = ["","Block","Subject","Lecture / Topic","Lecture Date","Last Studied","Days Ago","📖","🎓","📝","🃏","Anki Date","Confidence","Sessions","Score",""];
  const COL_TIPS  = ["","","","","Lecture date","Last date studied","Days since last study","Pre-Read","Attended Lecture","Post-Lecture Review","Anki Cards Released","Anki card release date","Confidence level (drives review frequency)","Number of practice sessions","Practice question score",""];

  const totalSessions = rows.reduce((a,r)=>a+(r.reps||0),0);
  const overallAvgScore = avg(rows.flatMap(r=>r.scores||[]));
  const repsBySubject = {};
  rows.forEach(r=>{ const s=r.subject||"Unknown"; repsBySubject[s]=(repsBySubject[s]||0)+(r.reps||0); });
  const mostPracticedSubject = Object.keys(repsBySubject).length ? Object.entries(repsBySubject).sort((a,b)=>b[1]-a[1])[0][0] : null;
  const withImprovement = rows.filter(r=>(r.scores||[]).length>=2).map(r=>{ const s=r.scores; return { row:r, diff: s[s.length-1]-s[0] }; });
  const mostImproved = withImprovement.length ? withImprovement.sort((a,b)=>b.diff-a.diff)[0] : null;
  const needingAttention = rows.filter(r=>{ const s=r.scores||[]; return s.length>=2 && s[s.length-1]<65 && s[s.length-2]<65; });

  const blocksArray = Object.values(blocks || {});
  const visibleBlocks = blocksArray.filter(block => {
    if (filter === "All") return true;
    const name = (block.name || "").trim();
    const id = block.id || "";
    const filterNorm = (filter || "").toLowerCase().replace(/\s/g, "");
    const nameNorm = name.toLowerCase().replace(/\s/g, "");
    return (
      block.name === filter ||
      block.id === filter ||
      (nameNorm && nameNorm === filterNorm)
    );
  });
  const allBlockLecs = blocksArray.flatMap(b => (lecs || []).filter(l => l.blockId === b.id));

  const makeKey = makeTopicKey || ((lectureId, blockId) => (lectureId ? `${lectureId}__${blockId}` : `block__${blockId}`));
  const getLecPerf = (lec, blockId) => {
    const key = makeKey(lec.id, blockId);
    if (performanceHistory[key]) return performanceHistory[key];
    const fallbackKey = Object.keys(performanceHistory || {}).find(k => k.startsWith(lec.id + "__"));
    if (fallbackKey) return performanceHistory[fallbackKey];
    return null;
  };

  const targetBlockIds = useMemo(() => {
    if (trackerBlockId) return [trackerBlockId];
    return Object.values(blocks || {}).map((b) => b?.id).filter(Boolean);
  }, [trackerBlockId, blocks]);

  const getAllTodayItems = useCallback(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
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
      const overdueList = getOverdueLectures(bid, completion || {});
      const overdueItems = overdueList
        .map((e) => {
          const lec = (lecs || []).find((l) => l.id === e.lectureId);
          if (!lec) return null;
          return {
            lec,
            blockId: bid,
            matchReason: "⏰ OVERDUE",
            isOverdue: true,
            urgency: 999,
            daysOverdue: e.daysOverdue || 0,
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
  }, [targetBlockIds, examDates, generateDailySchedule, completion, lecs]);

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
  }, [targetBlockIds, lecs, performanceHistory, completion]);

  const filterCounts = useMemo(() => {
    const allItems = getAllTodayItems();
    const twoDaysOut = new Date();
    twoDaysOut.setDate(twoDaysOut.getDate() + 2);
    twoDaysOut.setHours(23, 59, 59, 0);
    const isCritical = (item) => {
      const key = `${item.lec.id}__${item.blockId}`;
      const entry = (completion || {})[key];
      const lastConf = entry?.lastConfidence;
      const lastScore = getLecPerf(item.lec, item.blockId)?.score || 0;
      return lastConf === "struggling" || lastScore < 50;
    };
    const isSoon = (item) => {
      const key = `${item.lec.id}__${item.blockId}`;
      const entry = (completion || {})[key];
      const reviewDates = entry?.reviewDates || [];
      return reviewDates.some((d) => {
        const rd = new Date(d);
        return rd <= twoDaysOut;
      });
    };
    const isOk = (item) => {
      const key = `${item.lec.id}__${item.blockId}`;
      const entry = (completion || {})[key];
      const lastConf = entry?.lastConfidence;
      const lastScore = getLecPerf(item.lec, item.blockId)?.score || 0;
      return lastConf === "good" || lastScore >= 70;
    };
    return {
      all: allItems.length,
      critical: allItems.filter(isCritical).length,
      overdue: allItems.filter((i) => i.isOverdue || String(i.matchReason || "").toUpperCase().includes("OVERDUE")).length,
      soon: allItems.filter(isSoon).length,
      ok: allItems.filter(isOk).length,
    };
  }, [getAllTodayItems, completion, refreshKey]);

  const getBlockObjsFromProps = (blockId) => {
    const data = objectives[blockId] || { imported: [], extracted: [] };
    const all = [...(data.imported || []), ...(data.extracted || [])];
    const seen = new Set();
    return all.filter((obj) => {
      const key = (obj.objective || "").slice(0, 60).toLowerCase().replace(/\W/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const lecRowsByBlock = useMemo(() => {
    const out = {};
    const perf = performanceHistory || {};
    const rev = reviewedLectures || {};
    const active = activeSessions || {};
    visibleBlocks.forEach((block) => {
      const blockLecs = (lecs || []).filter((l) => l.blockId === block.id);
      const blockObjs = getBlockObjsFromProps(block.id);
      const seenLecIds = new Set();
      out[block.id] = blockLecs
        .filter((lec) => {
          if (seenLecIds.has(lec.id)) return false;
          seenLecIds.add(lec.id);
          return true;
        })
        .map((lec) => {
          const lecKey = makeKey(lec.id, block.id);
          const fallbackKey = Object.keys(perf).find((k) => k.startsWith(lec.id + "__"));
          const perfEntry = perf[lecKey] || (fallbackKey ? perf[fallbackKey] : null);
          const rawSessions = perfEntry?.sessions || [];
          const lecSessions = rawSessions.filter((s) => !s.lectureId || s.lectureId === lec.id);
          const sessionCount = lecSessions.length;
          const perfEntries = rawSessions.filter((s) => !s.lectureId || s.lectureId === lec.id);
          const avgScore =
            perfEntries.length > 0
              ? Math.round(
                  perfEntries.reduce((a, s) => a + (s.score ?? 0), 0) / perfEntries.length
                )
              : null;
          const isReviewed = !!rev[lecKey];
          const firstStudiedRaw = perfEntry?.firstStudied
            ? perfEntry.firstStudied
            : perfEntries.length > 0
              ? perfEntries.map((s) => s.date).filter(Boolean).sort()[0]
              : isReviewed && rev[lecKey]?.date
                ? rev[lecKey].date
                : null;
          const firstStudied = firstStudiedRaw ? new Date(firstStudiedRaw) : null;
          const lastSession = lecSessions.slice(-1)[0] || null;
          const lastStudied = perfEntry?.lastStudied
            ? new Date(perfEntry.lastStudied)
            : lastSession?.date
              ? new Date(lastSession.date)
              : null;
          const postMCQ = perfEntry?.postMCQScore ?? perfEntry?.lastScore ?? lastSession?.score ?? null;
          const nextReview = perfEntry?.nextReview ? new Date(perfEntry.nextReview) : null;
          const daysUntil = nextReview
            ? Math.ceil((nextReview - new Date()) / (1000 * 60 * 60 * 24))
            : null;
          const preSAQ = perfEntry?.preSAQScore ?? null;
          const lecObjs = blockObjs.filter(
            (o) =>
              String(o.lectureNumber) === String(lec.lectureNumber) ||
              o.linkedLecId === lec.id
          );
          const masteredCount = lecObjs.filter((o) => o.status === "mastered").length;
          const inProgressCount = lecObjs.filter((o) => o.status === "inprogress").length;
          let status = "untested";
          if (active[lecKey]) status = "inprogress";
          else if (sessionCount > 0 && avgScore !== null && avgScore >= 80) status = "ok";
          else if (sessionCount > 0 && avgScore !== null && avgScore < 60) status = "weak";
          else if (sessionCount > 0) status = "inprogress";
          else if (isReviewed) status = "reviewed";
          else if (inProgressCount > 0) status = "inprogress";
          let urgency = "untouched";
          if (status === "ok") urgency = "ok";
          else if (status === "weak") urgency = "weak";
          else if (status === "inprogress") urgency = "soon";
          else if (lastStudied && daysUntil !== null && daysUntil <= 0) urgency = "overdue";
          else if (lastStudied && daysUntil !== null && daysUntil <= 3) urgency = "soon";
          else if (lastStudied && postMCQ !== null && postMCQ < 60) urgency = "weak";
          else if (lastStudied) urgency = "ok";
          return {
            lec,
            perfEntry,
            lecSessions,
            lastStudied,
            firstStudied,
            nextReview,
            daysUntil,
            preSAQ,
            postMCQ,
            confidence: perfEntry?.confidenceLevel ?? null,
            sessionCount,
            mastered: masteredCount,
            struggling: lecObjs.filter((o) => o.status === "struggling").length,
            total: lecObjs.length,
            status,
            urgency,
            isReviewed,
          };
        });
    });
    return out;
  }, [visibleBlocks, lecs, performanceHistory, objectives, reviewedLectures, activeSessions, makeKey]);

  const globalStudyLog = Object.entries(performanceHistory || {})
    .flatMap(([key, perf]) => {
      const lecId = key.split("__")[0];
      const sessions = (perf.sessions || []).filter(
        s => !s.lectureId || s.lectureId === lecId
      );
      return sessions.map(s => {
        const label = resolveTopicLabel
          ? resolveTopicLabel(key, s, s.blockId)
          : (() => {
              const lec = allBlockLecs.find(l => key.startsWith(l.id));
              return lec?.lectureTitle || (key.includes("block__") ? "Block Exam" : key);
            })();
        return {
          ...s,
          key,
          label,
        };
      });
    })
    .sort((a,b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

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
        const overdueCount = getOverdueLectures(bid, completion || {}).length;
        const blockLecs = (lecs || []).filter((l) => l && l.blockId === bid);
        const trackedCount = Object.values(completion || {}).filter((e) => e && e.blockId === bid).length;
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
                {trackedCount}/{blockLecs.length} tracked
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

        {tab==="tracker" && <>
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
              const overdueCount = bid ? getOverdueLectures(bid, completion || {}).length : 0;
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
        <div style={{ marginLeft:"auto", display:"flex", gap:7, alignItems:"center" }}>
          {critCount>0 && <div style={{ background:t.statusBadBg,border:"1px solid "+t.statusBad,borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:16 }}>⚠</span><span style={{ fontFamily:MONO,color:t.statusBad,fontSize:13,fontWeight:700 }}>{critCount} critical</span></div>}
          {ovdCount>0  && <div style={{ background:t.statusBadBg,border:"1px solid "+t.statusBad,borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:16 }}>⏰</span><span style={{ fontFamily:MONO,color:t.statusBad,fontSize:13,fontWeight:700 }}>{ovdCount} overdue</span></div>}
          {[["Rows",rows.length],["Done",rows.filter(r=>r.preRead&&r.lecture&&r.postReview&&r.anki).length]].map(([l,v])=>(
            <div key={l} style={{ background:t.cardBg,borderRadius:6,padding:"3px 10px",display:"flex",gap:5,alignItems:"center", border:"1px solid "+t.border1 }}>
              <span style={{ color:t.text4,fontSize:13 }}>{l}</span>
              <span style={{ color:t.text1,fontSize:13,fontWeight:600 }}>{v}</span>
            </div>
          ))}
          <button onClick={()=>setShowAdd(true)} style={{ background:t.statusBad,border:"none",color:t.text1,padding:"6px 14px",borderRadius:7,cursor:"pointer",fontFamily:MONO,fontSize:13,fontWeight:700 }}>+ Add Row</button>
          {saveMsg&&<span style={{ fontSize:13,color:saveMsg==="saved"?t.statusGood:t.statusWarn }}>{saveMsg==="saving"?"⟳ Saving…":"✓ Saved"}</span>}
        </div>
      </div>

      {/* ── TRACKER TABLE ──────────────────────────────── */}
      {tab==="tracker" && (
        <div style={{ flex:1, overflowX:"auto", overflowY:"auto" }}>
          <div style={{ minWidth:1300 }}>

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
              const todayStr = new Date().toISOString().split("T")[0];
              const loggedToday = (lecId, blockId) => {
                const entry = completions[`${lecId}__${blockId}`];
                if (!entry || !entry.activityLog) return false;
                return entry.activityLog.some((a) => String(a?.date || "").startsWith(todayStr));
              };

              const allItemsBase = getAllTodayItems();
              const withNotStarted = (() => {
                if (!showNotStarted) return allItemsBase;
                const next = [...allItemsBase];
                bids.forEach((bid) => {
                  const blockLecs = (lecs || []).filter((l) => l.blockId === bid);
                  blockLecs.forEach((lec) => {
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

              const applyTodayFilter = (items, f) => {
                if (f === "all") return items;
                return items.filter((item) => {
                  const key = `${item.lec.id}__${item.blockId}`;
                  const entry = completions[key];
                  const lastConf = entry?.lastConfidence;
                  const lastScore = getLecPerf(item.lec, item.blockId)?.score || 0;
                  switch (f) {
                    case "critical":
                      return lastConf === "struggling" || lastScore < 50;
                    case "overdue":
                      return String(item.matchReason || "").toUpperCase().includes("OVERDUE") || item.isOverdue === true;
                    case "soon": {
                      const reviewDates = entry?.reviewDates || [];
                      const twoDaysOut = new Date();
                      twoDaysOut.setDate(twoDaysOut.getDate() + 2);
                      twoDaysOut.setHours(23, 59, 59, 0);
                      return reviewDates.some((d) => {
                        const rd = new Date(d);
                        return rd <= twoDaysOut;
                      });
                    }
                    case "ok":
                      return lastConf === "good" || lastScore >= 70;
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
                const filtered = applyTodayFilter(withNotStarted, todayFilter);
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
              const todayLectures = searchedItems.filter((it) => !overdueList.includes(it) && String(it._matchReason || it.matchReason || "") === "TODAY'S LECTURE");
              const reviewsDue = searchedItems.filter((it) => !overdueList.includes(it) && !todayLectures.includes(it));

              const snoozeReview = (lectureId, blockId) => {
                const key = `${lectureId}__${blockId}`;
                if (snoozedToday[key] === todayStr) return;
                setSnoozedToday((p) => ({ ...(p || {}), [key]: todayStr }));
                setCompletion((prev) => {
                  const ex = (prev || {})[key];
                  if (!ex) return prev;
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const tomorrow = new Date(today);
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
                  const rd = Array.isArray(ex.reviewDates) ? ex.reviewDates : [];
                  const pushed = rd.map((d) => {
                    const rd0 = new Date(d);
                    rd0.setHours(0, 0, 0, 0);
                    return rd0 < today ? tomorrowKey : d;
                  });
                  const deduped = Array.from(new Set(pushed)).sort();
                  return { ...(prev || {}), [key]: { ...ex, reviewDates: deduped } };
                });
              };

              const sectionLabelStyle = {
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 500,
                color: t.text3,
                letterSpacing: "0.06em",
                marginBottom: 6,
              };
              const cardStyle = {
                height: 44,
                padding: "8px 12px",
                background: t.cardBg,
                border: "0.5px solid " + t.border2,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                gap: 8,
              };
              const renderDonePill = (entry) => {
                const q = getTodayQuestionScoreForDonePill(entry, todayStr);
                return (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: t.statusGoodBg,
                      border: "1px solid " + t.statusGoodBorder,
                      color: t.statusGood,
                      fontWeight: 900,
                    }}
                  >
                    {q ? `✓ Done · ${q.correct}/${q.total} (${q.score}%)` : "✓ Done"}
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
              const sortedReviewsDue = [...reviewsDue].sort((a, b) => {
                const aDone = loggedToday(a.lec.id, a.blockId) ? 1 : 0;
                const bDone = loggedToday(b.lec.id, b.blockId) ? 1 : 0;
                if (aDone !== bDone) return aDone - bDone;
                if (a.isNotStarted && !b.isNotStarted) return 1;
                if (b.isNotStarted && !a.isNotStarted) return -1;
                return 0;
              });

              const hasAny = overdueList.length > 0 || todayLectures.length > 0 || reviewsDue.length > 0;
              if (!hasAny) {
                return (
                  <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ fontFamily: MONO, color: t.text3, fontSize: 12, marginBottom: 6 }}>Nothing scheduled today.</div>
                    <div style={{ fontFamily: MONO, color: t.text3, fontSize: 11 }}>Add lectures in the Lectures tab to begin tracking.</div>
                  </div>
                );
              }

              return (
                <div style={{ padding: "0 16px 18px" }}>
                  {!hasSeenClickHint && (
                    <div style={{ fontSize: 11, color: t.text3, textAlign: "center", padding: "6px 0", marginBottom: 8, fontFamily: MONO }}>
                      Tap any row to log activity
                    </div>
                  )}
                  {/* OVERDUE */}
                  {overdueList.length > 0 && (
                    <div>
                      <div style={sectionLabelStyle}>OVERDUE</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {overdueList.map((e) => {
                          const lec = e.lec || null;
                          const ebid = e.blockId;
                          const lid = lec?.id;
                          const done = lid ? loggedToday(lid, ebid) : false;
                          const entry = completions[`${lec?.id}__${ebid}`] || null;
                          const lastAct = entry?.activityLog?.[0] || null;
                          const lastDate = lastAct?.date ? String(lastAct.date).slice(0, 10) : "—";
                          const lastIcon = lastAct?.activityType ? mapActivityIcon(lastAct.activityType) : "✏️";
                          const conf = entry?.lastConfidence || null;
                          const confLine = conf === "good" ? "✓ Good" : conf === "struggling" ? "⚠ Struggling" : conf === "okay" ? "△ Okay" : "○ Unseen";
                          const late = e.daysOverdue || 0;
                          const lateIsWarn = late === 1;
                          const lateColor = lateIsWarn ? t.statusWarn : t.statusBad;
                          const lateLabel = lateIsWarn ? `△ 1d late` : `⚠ ${late}d late`;
                          const title = `${lec?.lectureType || "LEC"} ${lec?.lectureNumber ?? ""} — ${lec?.lectureTitle || lec?.title || lec?.filename || lec?.id || ""}`.trim();
                          const examDateE = examDates[ebid] || "";
                          const isOpen = quickLogOpenId === lid;
                          const handleRowToggle = () => {
                            if (done || !lid) return;
                            const next = isOpen ? null : lid;
                            if (next && !hasSeenClickHint) markTodayClickHintSeen();
                            setQuickLogOpenId(next);
                          };
                          const handleRowKeyDown = (ev) => {
                            if (done || !lid) return;
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              const next = isOpen ? null : lid;
                              if (next && !hasSeenClickHint) markTodayClickHintSeen();
                              setQuickLogOpenId(next);
                            }
                          };
                          return (
                            <React.Fragment key={`${lid}__${ebid}`}>
                              <div
                                tabIndex={done ? -1 : 0}
                                role={done ? undefined : "button"}
                                aria-expanded={done ? undefined : isOpen}
                                onClick={handleRowToggle}
                                onKeyDown={handleRowKeyDown}
                                style={{
                                  ...cardStyle,
                                  borderLeft: `3px solid ${t.statusBad}`,
                                  cursor: done ? "default" : "pointer",
                                  transition: "background 0.1s",
                                  background: isOpen ? t.inputBg : t.cardBg,
                                  borderBottom: isOpen ? "none" : "0.5px solid " + t.border2,
                                  borderRadius: isOpen ? "10px 10px 0 0" : "0 10px 10px 0",
                                  outline: "none",
                                  opacity: done ? 0.55 : 1,
                                }}
                                onMouseEnter={(ev) => {
                                  if (done) return;
                                  ev.currentTarget.style.background = t.inputBg;
                                }}
                                onMouseLeave={(ev) => {
                                  if (done) return;
                                  ev.currentTarget.style.background = isOpen ? t.inputBg : t.cardBg;
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                  <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: t.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {title}
                                  </div>
                                  <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    Overdue {late}d · Last: {lastIcon} {lastDate} · {confLine}
                                  </div>
                                </div>
                                <span style={{ fontFamily: MONO, fontSize: 10, padding: "4px 10px", borderRadius: 999, background: lateColor + "18", border: "1px solid " + lateColor, color: lateColor, fontWeight: 900, flexShrink: 0 }}>
                                  {lateLabel}
                                </span>
                                {done ? (
                                  renderDonePill(entry)
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      title="Snooze 1 day"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        snoozeReview(lid, ebid);
                                        if (quickLogOpenId === lid) setQuickLogOpenId(null);
                                        setRefreshKey((k) => k + 1);
                                      }}
                                      style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: 4,
                                        border: "0.5px solid " + t.border1,
                                        background: "transparent",
                                        color: t.text3,
                                        cursor: "pointer",
                                        fontSize: 12,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                        padding: 0,
                                        fontFamily: MONO,
                                      }}
                                    >
                                      ⏱
                                    </button>
                                    <span
                                      style={{
                                        fontSize: 12,
                                        color: isOpen ? t.text2 : t.text3,
                                        marginLeft: "auto",
                                        flexShrink: 0,
                                        paddingLeft: 8,
                                        display: "inline-block",
                                        transform: isOpen ? "rotate(90deg)" : "none",
                                      }}
                                    >
                                      ›
                                    </span>
                                  </>
                                )}
                              </div>
                              {done && weakConceptFlash?.key === `${lid}__${ebid}` && (
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
                              {done && (
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setQuickLogWrongOnlyKey(`${lid}__${ebid}`);
                                  }}
                                  style={{
                                    fontSize: 11,
                                    color: "var(--color-text-tertiary)",
                                    cursor: "pointer",
                                    border: "none",
                                    background: "transparent",
                                    padding: "4px 12px 0",
                                    textAlign: "left",
                                    width: "100%",
                                    fontFamily: MONO,
                                  }}
                                >
                                  + Log wrong questions from this session
                                </button>
                              )}
                              {done && quickLogWrongOnlyKey === `${lid}__${ebid}` && lec && (
                                <div
                                  style={{
                                    borderRadius: "0 0 10px 10px",
                                    borderTop: "0.5px solid " + t.border2,
                                    overflow: "hidden",
                                  }}
                                >
                                  <QuickLogWrongOnlyPanel
                                    lec={lec}
                                    blockId={ebid}
                                    onCancel={() => setQuickLogWrongOnlyKey(null)}
                                    onWrongConceptsLogged={(n) => {
                                      if (n > 0) {
                                        setWeakConceptFlash({
                                          key: `${lid}__${ebid}`,
                                          count: n,
                                        });
                                      }
                                    }}
                                    onDone={() => {
                                      setQuickLogWrongOnlyKey(null);
                                      setRefreshKey((k) => k + 1);
                                    }}
                                  />
                                </div>
                              )}
                              {!done && isOpen && lec && (
                                <div
                                  style={{
                                    borderRadius: "0 0 10px 10px",
                                    borderTop: "0.5px solid " + t.border2,
                                    overflow: "hidden",
                                  }}
                                >
                                  <QuickLogFormContent
                                    key={lec.id}
                                    lec={lec}
                                    blockId={ebid}
                                    examDate={examDateE}
                                    todayStr={todayStr}
                                    logActivity={logActivity}
                                    onWrongConceptsLogged={(n) => {
                                      if (n > 0) {
                                        setWeakConceptFlash({
                                          key: `${lid}__${ebid}`,
                                          count: n,
                                        });
                                      }
                                    }}
                                    onSave={() => {
                                      setQuickLogOpenId(null);
                                      setRefreshKey((k) => k + 1);
                                    }}
                                    onCancel={() => setQuickLogOpenId(null)}
                                  />
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* TODAY'S LECTURES */}
                  {todayLectures.length > 0 && (
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
                            if (done) return;
                            const next = isOpen ? null : lec.id;
                            if (next && !hasSeenClickHint) markTodayClickHintSeen();
                            setQuickLogOpenId(next);
                          };
                          const handleRowKeyDown = (ev) => {
                            if (done) return;
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              const next = isOpen ? null : lec.id;
                              if (next && !hasSeenClickHint) markTodayClickHintSeen();
                              setQuickLogOpenId(next);
                            }
                          };
                          return (
                            <React.Fragment key={lec.id}>
                              <div
                                tabIndex={done ? -1 : 0}
                                role={done ? undefined : "button"}
                                aria-expanded={done ? undefined : isOpen}
                                onClick={handleRowToggle}
                                onKeyDown={handleRowKeyDown}
                                style={{
                                  ...cardStyle,
                                  cursor: done ? "default" : "pointer",
                                  transition: "background 0.1s",
                                  background: isOpen ? t.inputBg : t.cardBg,
                                  borderBottom: isOpen ? "none" : "0.5px solid " + t.border2,
                                  borderRadius: isOpen ? "10px 10px 0 0" : 10,
                                  outline: "none",
                                  opacity: done ? 0.55 : 1,
                                }}
                                onMouseEnter={(ev) => {
                                  if (done) return;
                                  ev.currentTarget.style.background = t.inputBg;
                                }}
                                onMouseLeave={(ev) => {
                                  if (done) return;
                                  ev.currentTarget.style.background = isOpen ? t.inputBg : t.cardBg;
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                  <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: t.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {lec.lectureTitle || lec.title || lec.filename}
                                  </div>
                                  <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {week} · {sessions === 1 ? "1 session" : `${sessions} sessions`}
                                  </div>
                                </div>
                                {typePill(lec.lectureType)}
                                <span style={{ fontFamily: MONO, fontSize: 11, color: sessions === 0 ? t.text3 : t.statusProgress, fontWeight: 900 }}>
                                  {sessions === 0 ? "○ New" : `◑ ${sessions}x`}
                                </span>
                                {done ? (
                                  renderDonePill(entry)
                                ) : (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: isOpen ? t.text2 : t.text3,
                                      marginLeft: "auto",
                                      flexShrink: 0,
                                      paddingLeft: 8,
                                      display: "inline-block",
                                      transform: isOpen ? "rotate(90deg)" : "none",
                                    }}
                                  >
                                    ›
                                  </span>
                                )}
                              </div>
                              {done && weakConceptFlash?.key === `${lec.id}__${lbid}` && (
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
                              {done && (
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setQuickLogWrongOnlyKey(`${lec.id}__${lbid}`);
                                  }}
                                  style={{
                                    fontSize: 11,
                                    color: "var(--color-text-tertiary)",
                                    cursor: "pointer",
                                    border: "none",
                                    background: "transparent",
                                    padding: "4px 12px 0",
                                    textAlign: "left",
                                    width: "100%",
                                    fontFamily: MONO,
                                  }}
                                >
                                  + Log wrong questions from this session
                                </button>
                              )}
                              {done && quickLogWrongOnlyKey === `${lec.id}__${lbid}` && (
                                <div
                                  style={{
                                    borderRadius: "0 0 10px 10px",
                                    borderTop: "0.5px solid " + t.border2,
                                    overflow: "hidden",
                                  }}
                                >
                                  <QuickLogWrongOnlyPanel
                                    lec={lec}
                                    blockId={lbid}
                                    onCancel={() => setQuickLogWrongOnlyKey(null)}
                                    onWrongConceptsLogged={(n) => {
                                      if (n > 0) {
                                        setWeakConceptFlash({
                                          key: `${lec.id}__${lbid}`,
                                          count: n,
                                        });
                                      }
                                    }}
                                    onDone={() => {
                                      setQuickLogWrongOnlyKey(null);
                                      setRefreshKey((k) => k + 1);
                                    }}
                                  />
                                </div>
                              )}
                              {!done && isOpen && (
                                <div style={{ borderRadius: "0 0 10px 10px", borderTop: "0.5px solid " + t.border2, overflow: "hidden" }}>
                                  <QuickLogFormContent
                                    key={lec.id}
                                    lec={lec}
                                    blockId={lbid}
                                    examDate={examDateL}
                                    todayStr={todayStr}
                                    logActivity={logActivity}
                                    onWrongConceptsLogged={(n) => {
                                      if (n > 0) {
                                        setWeakConceptFlash({
                                          key: `${lec.id}__${lbid}`,
                                          count: n,
                                        });
                                      }
                                    }}
                                    onSave={() => {
                                      setQuickLogOpenId(null);
                                      setRefreshKey((k) => k + 1);
                                    }}
                                    onCancel={() => setQuickLogOpenId(null)}
                                  />
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* REVIEWS DUE */}
                  {reviewsDue.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={sectionLabelStyle}>REVIEWS DUE</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {sortedReviewsDue.map((t0) => {
                          const lec = t0.lec;
                          const lbid = t0.blockId;
                          const entry = completions[`${lec.id}__${lbid}`] || null;
                          const sessions = entry?.activityLog?.length || 0;
                          const done = loggedToday(lec.id, lbid);
                          const conf = confPill(entry?.lastConfidence || null);
                          const dots = (entry?.activityLog || []).slice(0, 5).map((a) => a?.confidenceRating || null);
                          const dotColor = (c) => (c === "good" ? "#639922" : c === "okay" ? "#BA7517" : c === "struggling" ? "#E24B4A" : null);
                          const padded = [...dots];
                          while (padded.length < 5) padded.push(null);
                          const examDateR = examDates[lbid] || "";
                          const isOpen = quickLogOpenId === lec.id;
                          const handleRowToggle = () => {
                            if (done) return;
                            const next = isOpen ? null : lec.id;
                            if (next && !hasSeenClickHint) markTodayClickHintSeen();
                            setQuickLogOpenId(next);
                          };
                          const handleRowKeyDown = (ev) => {
                            if (done) return;
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              const next = isOpen ? null : lec.id;
                              if (next && !hasSeenClickHint) markTodayClickHintSeen();
                              setQuickLogOpenId(next);
                            }
                          };
                          return (
                            <React.Fragment key={lec.id}>
                              <div
                                tabIndex={done ? -1 : 0}
                                role={done ? undefined : "button"}
                                aria-expanded={done ? undefined : isOpen}
                                onClick={handleRowToggle}
                                onKeyDown={handleRowKeyDown}
                                style={{
                                  ...cardStyle,
                                  cursor: done ? "default" : "pointer",
                                  transition: "background 0.1s",
                                  background: isOpen ? t.inputBg : t.cardBg,
                                  borderBottom: isOpen ? "none" : "0.5px solid " + t.border2,
                                  borderRadius: isOpen ? "10px 10px 0 0" : 10,
                                  outline: "none",
                                  opacity: done ? 0.55 : 1,
                                }}
                                onMouseEnter={(ev) => {
                                  if (done) return;
                                  ev.currentTarget.style.background = t.inputBg;
                                }}
                                onMouseLeave={(ev) => {
                                  if (done) return;
                                  ev.currentTarget.style.background = isOpen ? t.inputBg : t.cardBg;
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                  <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: t.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {lec.lectureTitle || lec.title || lec.filename}
                                  </div>
                                  <div style={{ fontFamily: MONO, fontSize: 11, color: t.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {t0._matchReason || "Review"} · {sessions === 1 ? "1 session" : `${sessions} sessions`}
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
                                  {padded.map((c, i) => (
                                    <div
                                      key={i}
                                      style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: 999,
                                        background: c ? dotColor(c) : "transparent",
                                        border: c ? "none" : "1px solid " + t.border2,
                                      }}
                                    />
                                  ))}
                                </div>
                                <span style={{ fontFamily: MONO, fontSize: 11, padding: "4px 10px", borderRadius: 999, background: (conf.bg || t.inputBg), border: "1px solid " + (conf.border || t.border1), color: conf.color, fontWeight: 900 }}>
                                  {conf.label}
                                </span>
                                {done ? (
                                  renderDonePill(entry)
                                ) : (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: isOpen ? t.text2 : t.text3,
                                      marginLeft: "auto",
                                      flexShrink: 0,
                                      paddingLeft: 8,
                                      display: "inline-block",
                                      transform: isOpen ? "rotate(90deg)" : "none",
                                    }}
                                  >
                                    ›
                                  </span>
                                )}
                              </div>
                              {done && weakConceptFlash?.key === `${lec.id}__${lbid}` && (
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
                              {done && (
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setQuickLogWrongOnlyKey(`${lec.id}__${lbid}`);
                                  }}
                                  style={{
                                    fontSize: 11,
                                    color: "var(--color-text-tertiary)",
                                    cursor: "pointer",
                                    border: "none",
                                    background: "transparent",
                                    padding: "4px 12px 0",
                                    textAlign: "left",
                                    width: "100%",
                                    fontFamily: MONO,
                                  }}
                                >
                                  + Log wrong questions from this session
                                </button>
                              )}
                              {done && quickLogWrongOnlyKey === `${lec.id}__${lbid}` && (
                                <div
                                  style={{
                                    borderRadius: "0 0 10px 10px",
                                    borderTop: "0.5px solid " + t.border2,
                                    overflow: "hidden",
                                  }}
                                >
                                  <QuickLogWrongOnlyPanel
                                    lec={lec}
                                    blockId={lbid}
                                    onCancel={() => setQuickLogWrongOnlyKey(null)}
                                    onWrongConceptsLogged={(n) => {
                                      if (n > 0) {
                                        setWeakConceptFlash({
                                          key: `${lec.id}__${lbid}`,
                                          count: n,
                                        });
                                      }
                                    }}
                                    onDone={() => {
                                      setQuickLogWrongOnlyKey(null);
                                      setRefreshKey((k) => k + 1);
                                    }}
                                  />
                                </div>
                              )}
                              {!done && isOpen && (
                                <div style={{ borderRadius: "0 0 10px 10px", borderTop: "0.5px solid " + t.border2, overflow: "hidden" }}>
                                  <QuickLogFormContent
                                    key={lec.id}
                                    lec={lec}
                                    blockId={lbid}
                                    examDate={examDateR}
                                    todayStr={todayStr}
                                    logActivity={logActivity}
                                    onWrongConceptsLogged={(n) => {
                                      if (n > 0) {
                                        setWeakConceptFlash({
                                          key: `${lec.id}__${lbid}`,
                                          count: n,
                                        });
                                      }
                                    }}
                                    onSave={() => {
                                      setQuickLogOpenId(null);
                                      setRefreshKey((k) => k + 1);
                                    }}
                                    onCancel={() => setQuickLogOpenId(null)}
                                  />
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 📅 Schedule — Exam countdown + smart daily study scheduler */}
            {false && (() => {
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
              const todayISO = new Date().toISOString().slice(0, 10);
              const overdueList = getOverdueLectures(bid, completion || {});
              const overdueIds = new Set(overdueList.map((e) => e.lectureId).filter(Boolean));

              const snoozeReview = (lectureId, blockId) => {
                const key = `${lectureId}__${blockId}`;
                if (snoozedToday[key] === todayISO) return;
                setSnoozedToday((p) => ({ ...(p || {}), [key]: todayISO }));
                setCompletion((prev) => {
                  const ex = (prev || {})[key];
                  if (!ex) return prev;
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const tomorrow = new Date(today);
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
                  const rd = Array.isArray(ex.reviewDates) ? ex.reviewDates : [];
                  const pushed = rd.map((d) => {
                    const rd0 = new Date(d);
                    rd0.setHours(0, 0, 0, 0);
                    return rd0 < today ? tomorrowKey : d;
                  });
                  const deduped = Array.from(new Set(pushed)).sort();
                  return { ...(prev || {}), [key]: { ...ex, reviewDates: deduped } };
                });
              };

              // Pass 0 — add review-due + Saturday sweep items (from rxt-completion)
              // When sweepMode, override entirely with sweep-eligible + untouched list.
              const schedule = (() => {
                if (sweepMode) {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const oneWeekAgo = new Date(today);
                  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                  const todayISO = today.toISOString().slice(0, 10);
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
                                                  onClick={() => markLectureReviewedToday(task.lec.id, bid)}
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
                                              setQuickLogState((p) => ({ ...(p || {}), [task.lec.id]: { open: true, submitting: false } }));
                                              setQuickLogDraft((p) => ({ ...(p || {}), [task.lec.id]: { activityType: "review", confidenceRating: "okay", note: "" } }));
                                              setQuickLogNoteOpen((p) => ({ ...(p || {}), [task.lec.id]: false }));
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
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                                              {[
                                                { v: "deep_learn", label: "🧠 Deep Learn" },
                                                { v: "review", label: "📖 Review" },
                                                { v: "anki", label: "🃏 Anki" },
                                                { v: "questions", label: "❓ Questions" },
                                                { v: "notes", label: "📝 Notes" },
                                                { v: "sg_tbl", label: "👥 SG/TBL" },
                                              ].map((opt) => (
                                                <button
                                                  key={opt.v}
                                                  type="button"
                                                  onClick={() => setQuickLogDraft((p) => ({ ...(p || {}), [task.lec.id]: { ...draft, activityType: opt.v } }))}
                                                  style={{ fontFamily: MONO, fontSize: 10, padding: "4px 8px", borderRadius: 999, border: "1px solid " + (draft.activityType === opt.v ? T.statusProgress : T.border1), background: draft.activityType === opt.v ? (T.statusProgress + "18") : T.cardBg, color: draft.activityType === opt.v ? T.statusProgress : T.text2, cursor: "pointer" }}
                                                >
                                                  {opt.label}
                                                </button>
                                              ))}
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
                                                setRefreshKey((k) => k + 1);
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
            })()}

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
                  setRefreshKey={setRefreshKey}
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
