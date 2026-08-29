export const EXAM_SECONDS_PER_QUESTION = 90;

export function examDurationMs(questionCount) {
  const count = Math.max(0, Number(questionCount) || 0);
  return count * EXAM_SECONDS_PER_QUESTION * 1000;
}

export function examDurationMinutes(questionCount) {
  return examDurationMs(questionCount) / 60_000;
}
