function localDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value || Date.now());
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function localDateKey(value) {
  const date = localDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Monday through Friday is the study week; the boundary is after Friday. */
export function fridayWeekKey(value) {
  const date = localDate(value);
  const day = date.getDay();
  const daysToFriday = day === 0 ? -2 : day === 6 ? -1 : 5 - day;
  date.setDate(date.getDate() + daysToFriday);
  return localDateKey(date);
}

export function lectureDate(lecture) {
  return lecture?.lectureDate || lecture?.date || lecture?.assignedDate || null;
}

function numericWeek(lecture) {
  return lecture?.weekNumber == null ? null : String(lecture.weekNumber);
}

export function currentStudyWeek(lectures = [], now = new Date()) {
  const dated = lectures
    .map((lecture) => ({ lecture, date: lectureDate(lecture) }))
    .filter(({ date }) => date && localDate(date) <= localDate(now))
    .sort((a, b) => localDate(b.date) - localDate(a.date));
  return dated[0] ? { key: fridayWeekKey(dated[0].date), weekNumber: numericWeek(dated[0].lecture) } : { key: fridayWeekKey(now), weekNumber: null };
}

function priorWeekKey(key, count) {
  const date = localDate(key);
  date.setDate(date.getDate() - (7 * count));
  return localDateKey(date);
}

export function filterLecturesByScope(lectures = [], scope = "block-so-far", now = new Date()) {
  const list = Array.isArray(lectures) ? lectures : [];
  const current = currentStudyWeek(list, now);
  if (scope === "entire-block") return list;
  const lectureScope = String(scope).match(/^lecture:(.+)$/);
  if (lectureScope) {
    let wanted = lectureScope[1];
    try { wanted = decodeURIComponent(wanted); } catch { /* retain legacy/raw ids */ }
    return list.filter((lecture) => String(lecture?.lectureId || lecture?.id || "") === wanted);
  }
  const range = String(scope).match(/^date-range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    const start = localDate(range[1]);
    const end = localDate(range[2]);
    if (start <= end) return list.filter((lecture) => {
      const date = lectureDate(lecture);
      if (!date) return false;
      const value = localDate(date);
      return value >= start && value <= end;
    });
  }
  const weekRange = String(scope).match(/^week-range:(\d+):(\d+)$/);
  if (weekRange) {
    const low = Math.min(Number(weekRange[1]), Number(weekRange[2])), high = Math.max(Number(weekRange[1]), Number(weekRange[2]));
    return list.filter((lecture) => { const week = Number(numericWeek(lecture)); return numericWeek(lecture) != null && week >= low && week <= high; });
  }
  if (scope.startsWith("week-number:") || /^\d+$/.test(String(scope))) {
    const wanted = scope.startsWith("week-number:") ? scope.slice("week-number:".length) : String(scope);
    return list.filter((lecture) => numericWeek(lecture) === wanted);
  }
  const dated = list.filter((lecture) => lectureDate(lecture));
  if (!dated.length) return list;
  if (scope === "current-week") return dated.filter((lecture) => fridayWeekKey(lectureDate(lecture)) === current.key);
  if (scope === "past-two-weeks") {
    const allowed = new Set([current.key, priorWeekKey(current.key, 1)]);
    return dated.filter((lecture) => allowed.has(fridayWeekKey(lectureDate(lecture))));
  }
  const today = localDate(now);
  return dated.filter((lecture) => localDate(lectureDate(lecture)) <= today);
}

export function scopeLabel(scope, lectures = []) {
  const lectureScope = String(scope || "").match(/^lecture:(.+)$/);
  if (lectureScope) {
    let wanted = lectureScope[1];
    try { wanted = decodeURIComponent(wanted); } catch { /* retain legacy/raw ids */ }
    const lecture = (lectures || []).find((item) => String(item?.lectureId || item?.id || "") === wanted);
    return lecture?.lectureLabel || lecture?.lectureTitle || lecture?.fileName || "Selected lecture";
  }
  const range = String(scope || "").match(/^date-range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (range) return `${range[1]} → ${range[2]}`;
  const weekRange = String(scope || "").match(/^week-range:(\d+):(\d+)$/);
  if (weekRange) return weekRange[1] === weekRange[2] ? `Week ${weekRange[1]}` : `Weeks ${weekRange[1]}–${weekRange[2]}`;
  return {
    "current-week": "This week · ends Friday",
    "past-two-weeks": "Past 2 weeks · Friday cutoff",
    "block-so-far": "Block so far",
    "entire-block": "Entire block",
  }[scope] || (scope.startsWith("week-number:") ? `Week ${scope.slice("week-number:".length)}` : /^\d+$/.test(String(scope)) ? `Week ${scope}` : scope);
}
