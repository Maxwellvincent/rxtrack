/** Return a lecture number when it is explicitly present in metadata or a label. */
export function lectureNumberOf(value, { allowBare = false } = {}) {
  if (value && typeof value === "object") {
    const stored = Number(value.lectureNumber ?? value.number);
    if (Number.isInteger(stored) && stored > 0) return stored;
    value = value.lectureTitle || value.title || value.fileName || "";
  }
  const label = String(value || "").trim();
  if (allowBare && /^\d{1,3}$/.test(label)) return Number(label);
  const match = label.match(/\b(?:NB|LEC|LECTURE)\s*(?:NO\.?\s*|#\s*)?(\d{1,3})\b/i);
  return match ? Number(match[1]) : null;
}

/** A stored objective number is a conflict only when both sides are known. */
export function objectiveLectureNumberConflict(objective, lecture) {
  if (objective?.manuallyAligned) return false;
  const objectiveNumber = lectureNumberOf(objective);
  const activeNumber = lectureNumberOf(lecture);
  return objectiveNumber != null && activeNumber != null && objectiveNumber !== activeNumber;
}
