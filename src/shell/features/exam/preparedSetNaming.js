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
