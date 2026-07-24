// scheduleParser.js — parse a med-school schedule md (marker/pdf2md output) into
// events, and filter to the ones that belong to this student.
//
// Filter (locked with Louis for BPM2 Fall 2026, cohort A / subgroup Curie):
//   KEEP  — ABCD or bare A cohort; A (Curie) subgroup; no-cohort "everyone" events
//           (Exam, ESoft Quiz, IMCQ, Module Orientation, OSPE, Lab Exam, BSCE-2).
//   DROP  — anything ITI (flipped-class duplicate); B/C/D-only; A (any non-Curie
//           subgroup, e.g. Galen&Taylor); CR-students-only.

const TIME = /(\d{1,2}:\d{2}(?:am|pm))/gi;

// Last top-level (...) group in a string, honoring nested parens. Used for location.
function lastTopLevelParen(s) {
  let depth = 0, start = -1, last = null;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") { if (depth === 0) start = i; depth++; }
    else if (s[i] === ")") { depth--; if (depth === 0 && start !== -1) last = s.slice(start + 1, i); }
  }
  return last;
}

// Activity keyword → { activity, number } from the text after "BPM2 <SYSTEM> ".
function parseActivity(body) {
  const b = body.trim();
  const num = (re) => { const m = b.match(re); return m && m[1] ? parseInt(m[1], 10) : null; };
  if (/^\d+\b/.test(b)) return { activity: "lecture", number: parseInt(b, 10) };
  if (/^Lab Exam\b/i.test(b)) return { activity: "Lab Exam", number: null };
  if (/^SIM Lab\b/i.test(b)) return { activity: "SIM Lab", number: null };
  if (/^Mini OSPE\b/i.test(b)) return { activity: "Mini OSPE", number: null };
  if (/^OSPE\b/i.test(b)) return { activity: "OSPE", number: null };
  if (/^SG\b/i.test(b)) return { activity: "SG", number: num(/^SG\s*(\d+)/i) };
  if (/^US\b/i.test(b)) return { activity: "US", number: num(/^US\s*(\d+)/i) };
  if (/^LAB\b/i.test(b)) return { activity: "Lab", number: num(/^LAB\s*(\d+)/i) };
  if (/^IMCQ\b/i.test(b)) return { activity: "IMCQ", number: num(/^IMCQ\s*(\d+)/i) };
  if (/^ESoft Quiz\b/i.test(b)) return { activity: "ESoft Quiz", number: num(/^ESoft Quiz\s*(\d+)/i) };
  if (/^Exam\b/i.test(b)) return { activity: "Exam", number: num(/^Exam\s*(\d+)/i) };
  if (/^Module Orientation\b/i.test(b)) return { activity: "Module Orientation", number: null };
  if (/^Final Assessment\b/i.test(b)) return { activity: "Final Assessment", number: null };
  if (/^BS?CE-?2?\b/i.test(b) || /^BSCE\b/i.test(b)) return { activity: "BSCE-2", number: null };
  return { activity: "other", number: num(/(\d+)/) };
}

export function parseEventLine(line) {
  if (!line) return null;
  const clean = String(line).replace(/^[\s\-*■←€]+/, "").replace(/\*\*/g, "").trim();
  const idx = clean.indexOf("BPM2");
  if (idx === -1) return null;

  const times = clean.slice(0, idx).match(TIME) || [];
  const start = times[0] || null;
  const end = times[1] || null;

  const prefix = clean.slice(0, idx);
  const iti = /\bITI\b/.test(prefix);
  // Cohort only when the prefix ends in a "COHORT[ (subgroup)]:" marker.
  const cm = prefix.match(/\b(ABCD|A|B|C|D)\b\s*(?:\(([^)]*)\))?\s*:/);
  const cohort = cm ? cm[1] : null;
  const subgroup = cm && cm[2] ? cm[2].trim() : null;

  const afterBpm = clean.slice(idx + "BPM2".length).trim();
  const sm = afterBpm.match(/^(ER|DM|NB|CR)\b/);
  const system = sm ? sm[1] : null;
  const body = sm ? afterBpm.slice(sm[0].length).trim() : afterBpm;
  const { activity, number } = parseActivity(body);

  return { raw: clean, start, end, cohort, subgroup, iti, system, activity, number, location: lastTopLevelParen(clean) };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Master scan: a weekday+month+day date header OR a time (range) anchoring an event.
// End time may be joined by a dash OR just whitespace (marker/OCR often drops the "-").
const SCAN = new RegExp(
  "(?<date>(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2})" +
  "|(?<time>\\d{1,2}:\\d{2}(?:am|pm)(?:\\s*[-–]?\\s+\\d{1,2}:\\d{2}(?:am|pm))?)",
  "gi"
);

function toISODate(header, fallbackYear) {
  const m = header.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})/i);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  const day = parseInt(m[2], 10);
  // This schedule runs Aug–Dec 2026; spill Jan–Jul into the next calendar year.
  const year = mon >= 7 ? fallbackYear : fallbackYear + 1;
  return `${year}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse a whole schedule md → this student's events, date-tagged, in order. */
export function parseSchedule(md, { year = 2026 } = {}) {
  const text = String(md || "").replace(/\|/g, "  ");
  const marks = [...text.matchAll(SCAN)];
  const out = [];
  let date = null;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m.groups.date) { date = toISODate(m.groups.date, year) || date; continue; }
    const seg = text.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : text.length);
    const ev = parseEventLine(seg);
    if (ev && isMine(ev)) out.push({ date, ...ev });
  }
  return out;
}

export function isMine(event) {
  if (!event) return false;
  if (event.iti) return false;                 // flipped-class duplicate — not attended
  if (event.system === "CR") return false;     // CR-students-only track
  if (event.cohort === null) return true;      // no cohort = everyone (exams, quizzes, OSPE…)
  if (event.cohort === "ABCD" || event.cohort === "A") {
    // Sub-rotation events (Lab/US/skills) name a group in parens; only Curie is mine.
    return event.subgroup === null || event.subgroup === "Curie";
  }
  return false;                                // B / C / D only
}
