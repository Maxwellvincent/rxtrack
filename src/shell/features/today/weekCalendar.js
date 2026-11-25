import { computeReviewDates } from "../../logic/completionLog.js";
import { lectureCompletion } from "../../../engine/lectureCompletion.js";
import { objectivePracticePlan, OBJECTIVE_MIN_ACCURACY } from "../../../engine/objectivePractice.js";

/**
 * How much a lecture still needs review, from independent answers on its objectives.
 * secure: first pass done, >=80% over enough questions, nothing struggling → no tail-end reviews.
 * need: 0 (secure) … 1 (weak or no evidence); low-need reviews give way when a day is full.
 */
export function lectureReviewNeed(objectives = [], evidence = {}, firstPass = null) {
  const rows = objectivePracticePlan(objectives, evidence).rows;
  const attempts = rows.reduce((n, row) => n + row.attempts, 0);
  const correct = rows.reduce((n, row) => n + row.correct, 0);
  const struggling = rows.filter((row) => row.struggling).length;
  const accuracy = attempts ? correct / attempts : null;
  const enough = attempts >= Math.max(5, rows.length);
  const secure = !!firstPass?.complete && enough && accuracy >= OBJECTIVE_MIN_ACCURACY && struggling === 0;
  const need = secure ? 0 : accuracy == null ? 1 : Math.min(1, Math.max(0.1, 1 - accuracy + (struggling ? 0.3 : 0) + (enough ? 0 : 0.2)));
  return { accuracy, attempts, struggling, secure, need };
}

const pad = (n) => String(n).padStart(2, "0");
export const dateKey = (value) => { const d = new Date(value); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const keyToDate = (key) => { const [y, m, d] = String(key).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };

/** Monday of the week containing `value`, shifted by `weekOffset` weeks. */
export function weekStart(value, weekOffset = 0) {
  const d = new Date(value); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7);
  return d;
}

/** Upcoming review days for one lecture; stored dates are re-spaced against the exam. */
export function reviewDaysFor(entry, perfNextReview, examDate) {
  const days = new Set();
  if (entry?.lastActivityDate) {
    const recomputed = examDate ? computeReviewDates(entry.lastActivityDate, entry.lastConfidence || "okay", examDate) : [];
    for (const d of recomputed) days.add(dateKey(d));
    if (!recomputed.length) for (const d of entry.reviewDates || []) days.add(String(d).slice(0, 10));
  }
  if (perfNextReview) days.add(dateKey(perfNextReview));
  return days;
}

const shiftKey = (key, days) => { const d = keyToDate(key); d.setDate(d.getDate() + days); return dateKey(d); };
const FIRST_PASS_UNITS = 2; // a first pass costs about two reviews
export const MIN_DAILY_UNITS = 5;

/**
 * Spread the remaining work (behind/new first passes + exam-aware reviews) over
 * today … the day before the exam so no day is overloaded. Each item may move
 * inside a small window around its ideal day; earliest deadline goes first.
 * Returns { byDay: Map(key → { items, units }), cap, behind }.
 */
export function planStudyLoad(rows, { todayKey, examKey = null, horizonDays = 14 }) {
  const lastKey = examKey && examKey > todayKey ? shiftKey(examKey, -1) : shiftKey(todayKey, horizonDays - 1);
  const clamp = (key) => key < todayKey ? todayKey : key > lastKey ? lastKey : key;
  const items = [];
  let behind = 0, secure = 0;
  const skipped = [];
  for (const row of rows) {
    const needsFirstPass = row.firstPass.total > 0 && !row.firstPass.complete && row.givenOn;
    if (needsFirstPass && row.givenOn <= lastKey) {
      const late = row.givenOn < todayKey;
      if (late) behind += 1;
      const ideal = clamp(row.givenOn);
      items.push({ row, kind: late ? "catchup" : "first", ideal, earliest: ideal, latest: clamp(shiftKey(ideal, late ? 2 : 1)), units: FIRST_PASS_UNITS });
    }
    const need = row.strength?.need ?? 1;
    if (row.strength?.secure) { if (row.reviews.size) secure += 1; continue; } // ≥80% and stable: skip reviews
    for (const key of row.reviews) {
      if (key < todayKey || key > lastKey || key === row.givenOn) continue;
      items.push({ row, kind: "review", ideal: key, earliest: clamp(shiftKey(key, -2)), latest: clamp(shiftKey(key, 1)), units: 1, need });
    }
  }
  const dayKeys = [];
  for (let key = todayKey; key <= lastKey; key = shiftKey(key, 1)) dayKeys.push(key);
  const total = items.reduce((n, item) => n + item.units, 0);
  const cap = Math.max(MIN_DAILY_UNITS, Math.ceil(total / Math.max(1, dayKeys.length)));
  // Ideal load per day, used to decide when pulling work forward is worth it.
  const idealLoad = new Map(dayKeys.map((key) => [key, 0]));
  for (const item of items) idealLoad.set(item.ideal, (idealLoad.get(item.ideal) || 0) + item.units);

  const byDay = new Map(dayKeys.map((key) => [key, { items: [], units: 0 }]));
  const pending = new Set(items);
  // First passes, then the reviews that are needed most; deadline breaks ties.
  const order = (a, b) => (a.kind === "review") - (b.kind === "review") || (b.need ?? 1) - (a.need ?? 1) || a.latest.localeCompare(b.latest) || a.ideal.localeCompare(b.ideal);
  for (const key of dayKeys) {
    const day = byDay.get(key);
    const has = new Set();
    const place = (item) => {
      if (has.has(item.row.id)) { // same lecture already today: wait for another day, or merge at the deadline
        if (item.latest <= key) pending.delete(item);
        return;
      }
      pending.delete(item);
      has.add(item.row.id);
      day.items.push(item); day.units += item.units;
    };
    const ready = [...pending].filter((item) => item.earliest <= key).sort(order);
    for (const item of ready) {
      if (item.latest > key) continue; // deadline today: place it, unless a full day can drop a well-known lecture
      if (item.kind === "review" && item.need < 0.5 && day.units + item.units > cap) { pending.delete(item); skipped.push(item); continue; }
      place(item);
    }
    for (const item of ready) if (pending.has(item) && item.ideal <= key && day.units + item.units <= cap) place(item);
    for (const item of ready) {
      if (!pending.has(item) || item.ideal <= key || day.units + item.units > cap) continue;
      if ((idealLoad.get(item.ideal) || 0) <= cap) continue; // its own day has room
      idealLoad.set(item.ideal, idealLoad.get(item.ideal) - item.units);
      place(item);
    }
  }
  return { byDay, cap, behind, secure, skipped, lastKey };
}

/**
 * One week of lectures by the day they were given, plus reviews due each day.
 * lecScores rows come from generateDailySchedule (lec, availableDate, nextReview).
 */
export function buildWeekCalendar({ lecScores = [], completion = {}, blockId, now = Date.now(), weekOffset = 0, examDate = null, objectivesFor = () => [], evidence = {} }) {
  const start = weekStart(now, weekOffset);
  const todayKey = dateKey(now);
  const examKey = examDate ? dateKey(keyToDate(String(examDate).slice(0, 10))) : null;
  const rows = lecScores.map((row) => {
    const lec = row.lec;
    const entry = completion[`${lec.id}__${blockId}`];
    const objectives = objectivesFor(lec.id);
    const firstPass = lectureCompletion(objectives, evidence);
    const strength = lectureReviewNeed(objectives, evidence, firstPass);
    return {
      id: lec.id,
      title: lec.lectureTitle || lec.fileName || lec.filename || "Lecture",
      type: lec.lectureType || "Lec",
      number: lec.lectureNumber ?? null,
      givenOn: row.availableDate ? dateKey(row.availableDate) : null,
      reviews: reviewDaysFor(entry, row.nextReview, examDate),
      firstPass,
      strength,
      lastActivity: entry?.lastActivityDate || null,
    };
  });
  const plan = planStudyLoad(rows, { todayKey, examKey });
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const key = dateKey(date);
    const given = rows.filter((row) => row.givenOn === key)
      .sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.title.localeCompare(b.title));
    // Past days show what was given; today on shows the balanced plan.
    const planned = plan.byDay.get(key);
    const withMove = (item) => ({ ...item.row, movedFrom: item.ideal !== key ? item.ideal : null });
    const reviews = planned ? planned.items.filter((item) => item.kind === "review").map(withMove) : [];
    const catchUp = planned ? planned.items.filter((item) => item.kind === "catchup" || (item.kind === "first" && item.row.givenOn !== key)).map(withMove) : [];
    const load = planned ? { units: planned.units, lectures: planned.items.length, over: planned.units > plan.cap } : null;
    return { key, date, isToday: key === todayKey, isPast: key < todayKey, isExam: key === examKey, isWeekend: i >= 5, given, catchUp, reviews, load };
  });
  return { start, days, cap: plan.cap, behind: plan.behind, secure: plan.secure, skipped: plan.skipped.length, label: `${days[0].date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${days[6].date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` };
}
