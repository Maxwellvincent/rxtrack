// School assessment formats for practice sets. Each preset sets the content
// scope and how much of the set must join two lectures:
//   Homework — one lecture, no cross-lecture items.
//   IMCQ     — the lectures of one week; partners from the same week.
//   ESoft    — a 2–3 week span; partners from anywhere in the span.
// "Custom" keeps the manual scope picker and the default share.

import { CROSS_LECTURE_SHARE } from "./crossLecture.js";

export const ASSESSMENT_FORMATS = {
  homework: { id: "homework", label: "Homework", detail: "One lecture", crossLectureShare: 0, window: "same-week", defaultScope: "lecture" },
  imcq: { id: "imcq", label: "IMCQ", detail: "One week · ~40% join two lectures", crossLectureShare: 0.4, window: "same-week", defaultScope: "current-week" },
  esoft: { id: "esoft", label: "ESoft", detail: "2–3 weeks · ~50% join two lectures", crossLectureShare: 0.5, window: "scope", defaultScope: "past-two-weeks" },
  custom: { id: "custom", label: "Custom", detail: "Pick any scope · ~25% join two lectures", crossLectureShare: CROSS_LECTURE_SHARE, window: "same-week", defaultScope: "block-so-far" },
};

export function assessmentFormat(id) {
  return ASSESSMENT_FORMATS[id] || ASSESSMENT_FORMATS.custom;
}

/** Scope options a preset allows, so the picker cannot contradict the format. */
export function scopeAllowed(formatId, scope) {
  const value = String(scope || "");
  if (formatId === "homework") return value.startsWith("lecture:");
  if (formatId === "imcq") return value === "current-week" || /^\d+$/.test(value) || value.startsWith("week-number:");
  if (formatId === "esoft") return value === "past-two-weeks" || value === "custom-dates" || value.startsWith("date-range:");
  return true;
}

/** The scope a preset starts on, given the lectures available. */
export function defaultScopeFor(formatId, lectures = []) {
  const preset = assessmentFormat(formatId);
  if (preset.defaultScope !== "lecture") return preset.defaultScope;
  const latest = [...(lectures || [])].filter(lecture => lecture?.lectureId)
    .sort((a, b) => String(b.lectureDate || b.date || "").localeCompare(String(a.lectureDate || a.date || "")) || (Number(b.lectureNumber) || 0) - (Number(a.lectureNumber) || 0))[0];
  return latest ? `lecture:${encodeURIComponent(latest.lectureId)}` : "block-so-far";
}

/** Generation options for a launch: share, partner window and candidates. */
export function crossLectureOptions(formatId, scopedLectures = []) {
  const preset = assessmentFormat(formatId);
  return {
    crossLectureShare: preset.crossLectureShare,
    crossLectureWindow: preset.window,
    crossLecturePartnerIds: (scopedLectures || []).map(lecture => lecture?.lectureId || lecture?.id).filter(Boolean),
  };
}
