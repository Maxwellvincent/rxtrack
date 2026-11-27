import { computeReviewDates } from "../../logic/completionLog.js";
import { studyDayDate } from "../../../studyDay.js";
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
  const struggling = rows.filter((row) => row.state === "struggling").length;
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
export const DAILY_LIMIT = 6;          // lectures per day, first passes and reviews together
export const DAILY_FIRST_PASS_LIMIT = 3; // new material per day

/**
 * Plan today … the day before the exam with at most DAILY_LIMIT lectures a day.
 * First passes come first (oldest first, at most DAILY_FIRST_PASS_LIMIT a day);
 * reviews fill the rest in order of need. A review whose window passes with no
 * room is dropped (lowest need first) instead of overloading a day; first passes
 * that cannot fit before the exam are returned as `unscheduled`.
 */
export function planStudyLoad(rows, { todayKey, examKey = null, horizonDays = 14, limit = DAILY_LIMIT, firstPassLimit = DAILY_FIRST_PASS_LIMIT }) {
  // Exam today or passed: nothing left to plan. No exam date: plan a rolling horizon.
  const lastKey = examKey ? shiftKey(examKey, -1) : shiftKey(todayKey, horizonDays - 1);
  const clamp = (key) => key < todayKey ? todayKey : key > lastKey ? lastKey : key;
  if (lastKey < todayKey) return { byDay: new Map(), cap: limit, behind: 0, secure: 0, skipped: [], unscheduled: [], lastKey };
  const items = [];
  let behind = 0, secure = 0;
  for (const row of rows) {
    const needsFirstPass = row.firstPass.total > 0 && !row.firstPass.complete && row.givenOn;
    if (needsFirstPass && row.givenOn <= lastKey) {
      const late = row.givenOn < todayKey;
      if (late) behind += 1;
      const ideal = clamp(row.givenOn);
      items.push({ row, kind: late ? "catchup" : "first", ideal, earliest: ideal, latest: lastKey });
    }
    if (row.strength?.secure) { if (row.reviews.size) secure += 1; continue; } // ≥80% and stable: no reviews
    const need = row.strength?.need ?? 1;
    for (const key of row.reviews) {
      if (key < todayKey || key > lastKey || key === row.givenOn) continue;
      items.push({ row, kind: "review", ideal: key, earliest: clamp(shiftKey(key, -2)), latest: clamp(shiftKey(key, 1)), need });
    }
  }
  const dayKeys = [];
  for (let key = todayKey; key <= lastKey; key = shiftKey(key, 1)) dayKeys.push(key);
  const idealLoad = new Map(dayKeys.map((key) => [key, 0]));
  // Forecast everything that wants a day, first passes included, so reviews are pulled forward in time.
  for (const item of items) idealLoad.set(item.ideal, (idealLoad.get(item.ideal) || 0) + 1);

  const byDay = new Map(dayKeys.map((key) => [key, { items: [], units: 0 }]));
  const pending = new Set(items);
  const skipped = [];
  const firstOrder = (a, b) => a.ideal.localeCompare(b.ideal) || (a.row.number ?? 999) - (b.row.number ?? 999);
  const reviewOrder = (a, b) => b.need - a.need || a.latest.localeCompare(b.latest) || a.ideal.localeCompare(b.ideal);
  for (const key of dayKeys) {
    const day = byDay.get(key);
    const has = new Set();
    const room = () => day.items.length < limit;
    const place = (item) => { pending.delete(item); has.add(item.row.id); day.items.push(item); day.units = day.items.length; };
    const ready = [...pending].filter((item) => item.earliest <= key);
    // 1. First passes, oldest first, capped so reviews still get time.
    let firsts = 0;
    for (const item of ready.filter((i) => i.kind !== "review").sort(firstOrder)) {
      if (firsts >= firstPassLimit || !room()) break;
      if (has.has(item.row.id)) continue;
      place(item); firsts += 1;
    }
    const reviews = ready.filter((i) => i.kind === "review" && pending.has(i)).sort(reviewOrder);
    // 2. Reviews due by today (or already late), most needed first.
    for (const item of reviews) if (item.ideal <= key && room() && !has.has(item.row.id)) place(item);
    // 3. Pull later reviews forward only when their own day is already over the limit.
    for (const item of reviews) {
      if (!pending.has(item) || item.ideal <= key || !room() || has.has(item.row.id)) continue;
      if ((idealLoad.get(item.ideal) || 0) <= limit) continue;
      idealLoad.set(item.ideal, idealLoad.get(item.ideal) - 1);
      place(item);
    }
    // 4. Reviews whose window ends today and found no room are dropped.
    for (const item of reviews) if (pending.has(item) && item.latest <= key) { pending.delete(item); if (!has.has(item.row.id)) skipped.push(item); }
  }
  const unscheduled = dayKeys.length ? [...pending].filter((item) => item.kind !== "review").map((item) => item.row) : [];
  return { byDay, cap: limit, behind, secure, skipped, unscheduled, lastKey };
}

/**
 * One week of lectures by the day they were given, plus reviews due each day.
 * lecScores rows come from generateDailySchedule (lec, availableDate, nextReview).
 */
export function buildWeekCalendar({ lecScores = [], completion = {}, blockId, now = Date.now(), weekOffset = 0, examDate = null, objectivesFor = () => [], evidence = {}, limit = DAILY_LIMIT }) {
  // Late-night study counts toward the previous day until the personal rollover hour.
  const studyNow = studyDayDate(now);
  const start = weekStart(studyNow, weekOffset);
  const todayKey = dateKey(studyNow);
  const examKey = examDate ? dateKey(keyToDate(String(examDate).slice(0, 10))) : null;
  const rows = lecScores.map((row) => {
    const lec = row.lec;
    const entry = completion[`${lec.id}__${blockId}`];
    const objectives = objectivesFor(lec.id);
    const firstPass = lectureCompletion(objectives, evidence);
    const strength = lectureReviewNeed(objectives, evidence, firstPass);
    return {
      id: lec.id,
      lec,
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
  const plan = planStudyLoad(rows, { todayKey, examKey, limit, firstPassLimit: Math.min(4, Math.max(1, Math.floor(limit / 2))) });
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const key = dateKey(date);
    // Past days show what was given; today on shows the balanced plan.
    const planned = plan.byDay.get(key);
    const plannedHere = new Set((planned?.items || []).map((item) => item.row.id));
    // A lecture given today on whose first pass was planned elsewhere shows only on that day.
    const given = rows.filter((row) => row.givenOn === key && (!planned || plannedHere.has(row.id) || row.firstPass.complete || !row.firstPass.total))
      .sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.title.localeCompare(b.title));
    const withMove = (item) => ({ ...item.row, movedFrom: item.ideal !== key ? item.ideal : null });
    const reviews = planned ? planned.items.filter((item) => item.kind === "review").map(withMove) : [];
    const catchUp = planned ? planned.items.filter((item) => item.kind === "catchup" || (item.kind === "first" && item.row.givenOn !== key)).map(withMove) : [];
    const load = planned ? { lectures: planned.items.length } : null;
    return { key, date, isToday: key === todayKey, isPast: key < todayKey, isExam: key === examKey, isWeekend: i >= 5, given, catchUp, reviews, load };
  });
  return { start, days, rows, cap: plan.cap, behind: plan.behind, secure: plan.secure, skipped: plan.skipped.length, unscheduled: plan.unscheduled, label: `${days[0].date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${days[6].date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` };
}

/** The order a day is worked through: new lectures, catch-up first passes, then reviews. */
export function dayQueue(day) {
  if (!day) return [];
  return [
    ...day.given.filter((row) => !row.firstPass.complete && row.firstPass.total > 0).map((row) => ({ row, kind: "first" })),
    ...day.catchUp.map((row) => ({ row, kind: "first" })),
    ...day.reviews.map((row) => ({ row, kind: "review" })),
  ];
}

/**
 * Today's queue once frozen. `stored` is `{ cap, items: [{id, kind}] }` (or a
 * bare items array saved before the cap was kept). Frozen items stay in order
 * whatever the recomputed plan says; an item whose lecture has not loaded yet
 * is left out for now but still holds its slot, so a reload never backfills a
 * new lecture. Newly planned items join only when the daily limit was raised
 * above the frozen cap.
 */
export function frozenDayQueue({ stored, fresh = [], rows = [], limit = DAILY_LIMIT }) {
  if (!stored) return fresh;
  const items = Array.isArray(stored) ? stored : Array.isArray(stored.items) ? stored.items : [];
  const cap = Array.isArray(stored) ? items.length : Number(stored.cap) || items.length;
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const kept = items.map((item) => rowsById.has(item.id) ? { row: rowsById.get(item.id), kind: item.kind } : null).filter(Boolean);
  const keys = new Set(items.map((item) => `${item.id}:${item.kind}`));
  const extra = fresh.filter((item) => !keys.has(`${item.row.id}:${item.kind}`)).slice(0, Math.max(0, limit - Math.max(cap, items.length)));
  return [...kept, ...extra];
}

/** Objectives a review quiz should aim at: struggling, then least accurate, then unanswered. */
export function weakFocusObjectiveIds(objectives = [], evidence = {}, n = 4) {
  return objectivePracticePlan(objectives, evidence).rows
    .map((row) => ({ id: row.id, score: row.state === "struggling" ? -1 : row.accuracy == null ? 0.5 : row.accuracy, ready: row.ready }))
    .filter((row) => !row.ready)
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map((row) => row.id);
}
