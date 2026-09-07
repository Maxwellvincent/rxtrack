const DAY = 86400000;
const SCHOOL_STYLE = /examsoft|esoft/i;

const millis = (value) => value?.toMillis?.() ?? (Number.isFinite(value) ? value : Date.parse(value || ""));

export function nextSchoolReview({ banks = [], sessions = [], now = Date.now(), examDate = null }) {
  const candidates = banks.filter((bank) => SCHOOL_STYLE.test(bank.filename || ""));
  const examAt = Date.parse(examDate || "");
  const plans = candidates.flatMap((bank) => {
    const attempts = sessions
      .filter((session) => session?.sourceType === "question-bank" && session.sourceFile === bank.filename && session.status === "submitted")
      .sort((a, b) => millis(a.submittedAt) - millis(b.submittedAt));
    if (attempts.length >= 3) return [];
    const lastAt = millis(attempts.at(-1)?.submittedAt);
    let dueAt = attempts.length === 0 ? now : lastAt + (attempts.length === 1 ? 3 : 2) * DAY;
    if (attempts.length === 2 && Number.isFinite(examAt)) dueAt = Math.min(dueAt, examAt - DAY);
    return [{
      filename: bank.filename,
      title: String(bank.filename).replace(/\.(pdf|md|txt)$/i, "").replace(/[+_]+/g, " ").replace(/\s+/g, " ").trim(),
      pass: attempts.length + 1,
      dueAt,
      due: dueAt <= now,
      mode: attempts.length === 2 ? "Timed" : "Practice",
      purpose: ["Find the gaps; do not chase a perfect score.", "Check the repairs after 2–4 days.", "Rehearse under exam timing."][attempts.length],
    }];
  });
  return plans.sort((a, b) => Number(b.due) - Number(a.due) || a.dueAt - b.dueAt || a.title.localeCompare(b.title))[0] || null;
}
