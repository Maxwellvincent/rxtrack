// Study-day rollover is personal; calendar dates on lectures/exams stay unchanged.
const PERSONAL_ROLLOVERS = { KX9K9IK4DgU0dBoAD6pj6Q4CEgr1: 4 };
let activeUserId = null;
export function setStudyDayUser(userId) { activeUserId = userId ?? null; }
export function studyDayHour(userId = activeUserId) { return PERSONAL_ROLLOVERS[userId] ?? 0; }
export function studyDayDate(value = new Date(), userId = activeUserId) {
  const date = new Date(value);
  if (date.getHours() < studyDayHour(userId)) date.setDate(date.getDate() - 1);
  return date;
}
export function studyDayKey(value = new Date(), userId = activeUserId) {
  const date = studyDayDate(value, userId);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function nextStudyDayDelay(value = new Date(), userId = activeUserId) {
  const now = new Date(value), next = new Date(value);
  next.setHours(studyDayHour(userId), 0, 1, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1, next - now);
}
export function studyDayRange(value = new Date(), userId = activeUserId) {
  const start = studyDayDate(value, userId);
  start.setHours(studyDayHour(userId), 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startAt: start.getTime(), endAt: end.getTime() - 1 };
}

export function studyDayMinutes(value = new Date(), userId = activeUserId) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes() + (date.getHours() < studyDayHour(userId) ? 1440 : 0);
}
