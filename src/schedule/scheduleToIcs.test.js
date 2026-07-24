import { describe, it, expect } from "vitest";
import { scheduleToIcs, mergeQuizWindows } from "./scheduleToIcs.js";

const ev = (date, start, end, system, activity, number, location) =>
  ({ date, start, end, system, activity, number, location });

describe("mergeQuizWindows", () => {
  it("collapses an open(8am) + due(11:55pm) quiz pair spanning two days into one window", () => {
    const events = [
      ev("2026-08-19", "8:00am", null, "ER", "ESoft Quiz", 1, "Online Quiz"),
      ev("2026-08-20", "11:55pm", null, "ER", "ESoft Quiz", 1, "Online Quiz"),
    ];
    const merged = mergeQuizWindows(events);
    const q = merged.filter((e) => e.activity === "ESoft Quiz");
    expect(q).toHaveLength(1);
    expect(q[0].date).toBe("2026-08-19");
    expect(q[0].start).toBe("8:00am");
    expect(q[0].endDate).toBe("2026-08-20");
    expect(q[0].end).toBe("11:55pm");
  });
  it("leaves non-quiz events untouched", () => {
    const events = [ev("2026-08-12", "8:00am", "8:50am", "ER", "lecture", 1, "Charter Hall")];
    expect(mergeQuizWindows(events)).toHaveLength(1);
  });
});

describe("scheduleToIcs", () => {
  const events = [ev("2026-08-12", "8:00am", "8:50am", "ER", "lecture", 1, "Charter Hall")];
  const ics = scheduleToIcs(events);

  it("wraps events in a VCALENDAR", () => {
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(ics.trimEnd()).toMatch(/END:VCALENDAR$/);
  });
  it("emits one VEVENT per event with local DTSTART/DTEND", () => {
    expect((ics.match(/BEGIN:VEVENT/g) || [])).toHaveLength(1);
    expect(ics).toMatch(/DTSTART:20260812T080000/);
    expect(ics).toMatch(/DTEND:20260812T085000/);
  });
  it("summarizes and locates the event", () => {
    expect(ics).toMatch(/SUMMARY:ER Lecture 01/);
    expect(ics).toMatch(/LOCATION:Charter Hall/);
  });
  it("converts 12h times correctly (noon, midnight, pm)", () => {
    const i = scheduleToIcs([ev("2026-10-23", "12:00pm", "12:30am", "NB", "Exam", 3, "Hall")]);
    expect(i).toMatch(/DTSTART:20261023T120000/); // 12pm = noon
    expect(i).toMatch(/DTEND:20261023T003000/);   // 12:30am = 00:30
  });
});
