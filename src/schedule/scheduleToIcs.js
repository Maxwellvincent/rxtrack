// scheduleToIcs.js — turn parsed schedule events into an iCalendar (.ics) file
// the student can import into Google Calendar. Floating local times (no TZID) so
// each event shows at its stated clock time in the viewer's calendar.

// "8:00am" / "12:30pm" → { h, m } in 24h.
function parse12h(t) {
  const m = String(t || "").match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;          // 12 → 0
  if (/pm/i.test(m[3])) h += 12;            // pm → +12 (12pm stays 12, 12am→0)
  return { h, m: parseInt(m[2], 10) };
}

const pad = (n) => String(n).padStart(2, "0");
const stampDate = (isoDate) => (isoDate || "").replace(/-/g, "");           // 2026-08-12 → 20260812
const dtLocal = (isoDate, time) => {
  const t = parse12h(time) || { h: 0, m: 0 };
  return `${stampDate(isoDate)}T${pad(t.h)}${pad(t.m)}00`;
};

// Add `mins` to an isoDate+time, returning "YYYYMMDDTHHmmSS" (handles day rollover).
function plusMinutes(isoDate, time, mins) {
  const t = parse12h(time) || { h: 0, m: 0 };
  const d = new Date(`${isoDate}T${pad(t.h)}:${pad(t.m)}:00`);
  d.setMinutes(d.getMinutes() + mins);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");

function summary(e) {
  const n = e.number != null ? " " + String(e.number).padStart(2, "0") : "";
  const label = e.activity === "lecture" ? "Lecture" : e.activity;
  return `${e.system ? e.system + " " : ""}${label}${n}`.trim();
}

// Collapse ESoft-Quiz open(8am)+due(11:55pm) pairs (same system+number, possibly
// on different days) into one window event: start = earliest, end = latest.
export function mergeQuizWindows(events) {
  const out = [];
  const quizzes = new Map(); // key → merged event
  for (const e of events) {
    if (e.activity !== "ESoft Quiz") { out.push(e); continue; }
    const key = `${e.system}::${e.number}`;
    const cur = quizzes.get(key);
    if (!cur) {
      quizzes.set(key, { ...e, endDate: e.date, end: e.end || e.start });
    } else {
      // earliest date+time is the open; latest is the due.
      if (`${e.date}${dtLocal(e.date, e.start)}` < `${cur.date}${dtLocal(cur.date, cur.start)}`) {
        cur.date = e.date; cur.start = e.start;
      }
      if (`${e.date}${dtLocal(e.date, e.start)}` > `${cur.endDate}${dtLocal(cur.endDate, cur.end)}`) {
        cur.endDate = e.date; cur.end = e.start;
      }
    }
  }
  return [...out, ...quizzes.values()];
}

function vevent(e, i) {
  const dtstart = dtLocal(e.date, e.start);
  const dtend = e.end
    ? dtLocal(e.endDate || e.date, e.end)
    : plusMinutes(e.date, e.start, 50); // default 50-min block when no end time
  const uid = `rxt-${e.date}-${i}-${(e.system || "x")}${e.number ?? ""}@rxtrack`;
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${esc(summary(e))}`,
    e.location ? `LOCATION:${esc(e.location)}` : null,
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}

export function scheduleToIcs(events, { calName = "RXTrack schedule" } = {}) {
  const list = mergeQuizWindows(events).filter((e) => e.date && e.start);
  const body = list.map((e, i) => vevent(e, i)).join("\r\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RXTrack//Schedule//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(calName)}`,
    body,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
