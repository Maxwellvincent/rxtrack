/**
 * What survived Tracker.jsx (SP1 T6.1).
 *
 * The tracker moved into the shell, but App still needs three of its helpers:
 * the derived lecture date, marking a lecture for today's review, and the
 * confidence trend. They are ported verbatim, with the private helpers they
 * depended on, so deleting the 552KB component changes nothing about how App
 * behaves.
 *
 * NOTE: `getDerivedLectureDate` keeps the original UTC-then-local date parsing.
 * The shell's `schedule.js` deliberately diverges (a YYYY-MM-DD is a local
 * calendar date there); this one is left as-is because App's surfaces were
 * written around it, and App is on its way out.
 */

/** Study day starts at 3am local — after midnight still counts as the previous day. */
export function startOfStudyDay() {
  const now = new Date();
  const boundary = new Date(now);
  boundary.setHours(3, 0, 0, 0);
  if (now < boundary) boundary.setDate(boundary.getDate() - 1);
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

function resolveBlockForSchedule(blocks, blockId) {
  if (!blocks || !blockId) return null;
  if (Array.isArray(blocks)) return blocks.find((b) => b && b.id === blockId) || null;
  return blocks[blockId] || null;
}

/** Calendar date from lectureDate, or weekNumber + dayOfWeek + block.startDate. */
export function getDerivedLectureDate(lec, blockId, blocks) {
  if (!lec) return null;
  if (lec.lectureDate) {
    const d = new Date(lec.lectureDate);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (!lec.weekNumber || lec.dayOfWeek == null || lec.dayOfWeek === "") return null;

  const block = resolveBlockForSchedule(blocks, blockId);
  const blockStart = block?.startDate ? new Date(block.startDate) : null;
  if (!blockStart || isNaN(blockStart.getTime())) return null;
  blockStart.setHours(0, 0, 0, 0);

  const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  let targetDow = DOW[lec.dayOfWeek];
  if (targetDow === undefined) {
    const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const s = String(lec.dayOfWeek).slice(0, 3).toLowerCase();
    const idx = order.findIndex((x) => s.startsWith(x));
    const monSunMap = [1, 2, 3, 4, 5, 6, 0];
    targetDow = idx >= 0 ? monSunMap[idx] : 1;
  }

  const wn = Number(lec.weekNumber);
  if (!Number.isFinite(wn)) return null;

  const startDay = blockStart.getDay();
  const toMonday = startDay === 0 ? -6 : 1 - startDay;
  const weekOneMon = new Date(blockStart);
  weekOneMon.setDate(blockStart.getDate() + toMonday);
  weekOneMon.setHours(0, 0, 0, 0);

  const derived = new Date(weekOneMon);
  derived.setDate(weekOneMon.getDate() + (wn - 1) * 7 + (targetDow === 0 ? 6 : targetDow - 1));
  derived.setHours(0, 0, 0, 0);
  return derived;
}

/** Put a lecture on today's review list, marking it as struggling. */
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
    const alreadyToday = (existing.reviewDates || []).some(
      (d) => String(d || "").slice(0, 10) === todayKey
    );
    if (!alreadyToday) existing.reviewDates = [todayKey, ...(existing.reviewDates || [])];

    existing.lastConfidence = "struggling";
    if (!existing.firstCompletedDate) existing.firstCompletedDate = todayISO;

    stored[key] = { ...existing, lectureId: lec.id, blockId };
    localStorage.setItem(completionKey, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent("rxt-completion-updated"));
    return true;
  } catch (e) {
    console.error("addLectureToTodayReview failed:", e);
    return false;
  }
}

/** Recent-confidence direction from a completion activity log. */
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
