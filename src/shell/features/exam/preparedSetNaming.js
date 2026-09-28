/** Give replacement-content launches a distinct, stable-to-read exam title. */
export function namePreparedReplacementAttempt(baseName, sessions = []) {
  const base = String(baseName || "Integrated exam").trim();
  const prefix = `${base} — New questions `;
  let highest = 1;
  for (const session of sessions || []) {
    const title = String(session?.title || "").trim();
    if (title === base) highest = Math.max(highest, 1);
    else if (title.startsWith(prefix)) {
      const suffix = Number(title.slice(prefix.length));
      if (Number.isInteger(suffix)) highest = Math.max(highest, suffix);
    }
  }
  return `${prefix}${highest + 1}`;
}

/** Suggest a useful launch title without making the learner type one. */
export function suggestedExamName({ format = "exam", scopeLabel = "Block so far", questionCount = 20, now = new Date(), existingNames = [] } = {}) {
  const kind = format === "practice" ? "Practice quiz" : "Timed exam";
  const date = now instanceof Date ? now : new Date(now);
  const dateLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
  const base = `${kind} · ${scopeLabel} · ${questionCount} questions · ${dateLabel}`;
  const names = new Set((existingNames || []).map((name) => String(name || "").trim().toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let attempt = 2;
  while (names.has(`${base} · Set ${attempt}`.toLocaleLowerCase())) attempt += 1;
  return `${base} · Set ${attempt}`;
}
