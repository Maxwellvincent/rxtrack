import { computeReviewDates, localDateString } from "../../logic/completionLog.js";

// Calendar-only values must stay local; parsing them as UTC shifts dates west of GMT.
const timestamp = value => {
 if (value == null || value === "") return null;
 if (value?.toMillis) return value.toMillis();
 if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
  const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d).getTime();
 }
 const result = new Date(value).getTime(); return Number.isFinite(result) ? result : null;
};
export function lectureReviewTiming(row, blockId, completion = {}, evidence = {}, getLecPerf, now = Date.now()) {
 const ids = [...new Set([row.lec.id, ...(row.lec.mergedFrom || []).map(item => item.id)])];
 const entries = ids.map(id => completion[`${id}__${blockId}`]).filter(Boolean);
 const manual = entries.flatMap(entry => entry.activityLog || []).filter(item => item.activityType === "review");
 const events = (evidence.evidenceJournal || []).filter(event => ids.includes(event.lectureId) && (!event.blockId || event.blockId === blockId));
 const performance = ids.map(id => getLecPerf?.({ id }, blockId)).filter(Boolean);
 const dates = [...manual.map(item => item.date), ...events.map(event => event.at), ...performance.flatMap(entry => (entry.sessions || []).map(session => session.at)), ...ids.map(id => evidence.lectures?.[id]?.lastSeen)].map(timestamp).filter(value => value != null && value <= now);
 if (!dates.length) return { lastReviewedAt: null, nextReview: null, status: "unknown" };
 const lastReviewedAt = Math.max(...dates);
 const lastDay = localDateString(lastReviewedAt), today = localDateString(now);
 // Honor an existing schedule only when it belongs to the latest activity.
 const scheduled = entries.filter(entry => (timestamp(entry.lastActivityDate) ?? -1) >= lastReviewedAt)
  .flatMap(entry => entry.reviewDates || []).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= lastDay).sort();
 const confidence = row.st > 0 ? "low" : row.m === row.total ? "good" : "okay";
 const nextReview = scheduled[0] || localDateString(computeReviewDates(lastDay, confidence, null)[0]);
 return { lastReviewedAt, nextReview, status: nextReview <= today ? "due" : "upcoming" };
}
export function reviewDateLabel(value) {
 const at = timestamp(value);
 return at == null ? "Date unavailable" : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
