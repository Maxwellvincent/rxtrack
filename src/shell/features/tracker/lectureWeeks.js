import { fridayWeekKey } from "../../logic/weekScope.js";

function asLocalDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatRange(fridayKey) {
  const friday = asLocalDate(fridayKey);
  const monday = new Date(friday);
  monday.setDate(monday.getDate() - 4);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" });
  if (monday.getMonth() === friday.getMonth()) {
    return `${month.format(monday)} ${monday.getDate()}–${friday.getDate()}`;
  }
  return `${month.format(monday)} ${monday.getDate()}–${month.format(friday)} ${friday.getDate()}`;
}

/** Groups schedule rows into chronological Monday–Friday school weeks. */
export function buildLectureWeeks(rows = []) {
  const dated = new Map();
  let unscheduledCount = 0;
  for (const row of rows) {
    const date = asLocalDate(row.availableDate);
    if (!date) {
      unscheduledCount += 1;
      continue;
    }
    const key = fridayWeekKey(date);
    dated.set(key, (dated.get(key) || 0) + 1);
  }
  const keys = [...dated.keys()].sort();
  const weeks = keys.map((key, index) => ({
    key: `week:${key}`,
    fridayKey: key,
    label: `Week ${index + 1}`,
    range: formatRange(key),
    count: dated.get(key),
  }));
  if (unscheduledCount) weeks.push({ key: "unscheduled", label: "Unscheduled", count: unscheduledCount });
  return weeks;
}

export function rowMatchesWeek(row, weekKey) {
  if (weekKey === "all") return true;
  const date = asLocalDate(row.availableDate);
  if (weekKey === "unscheduled") return !date;
  return !!date && `week:${fridayWeekKey(date)}` === weekKey;
}
