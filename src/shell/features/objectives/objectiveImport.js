function textKey(objective) {
  return String(objective?.objective || objective?.text || "")
    .slice(0, 80)
    .toLowerCase()
    .replace(/\W/g, "");
}

/** Return the first valid SOM code, even when an old import joined two codes. */
export function canonicalObjectiveCode(objective) {
  const raw = String(objective?.code || objective?.objectiveCode || "");
  const start = raw.search(/SOM/i);
  if (start < 0) return "";
  const afterStart = raw.slice(start + 3);
  const nextSom = afterStart.search(/SOM/i);
  const firstCodeOnly = nextSom >= 0 ? raw.slice(start, start + 3 + nextSom) : raw.slice(start);
  return firstCodeOnly.match(/SOM(?:\.\s?[A-Za-z0-9]+)+\.\s?\d{4}/i)?.[0]
    ?.replace(/\s/g, "")
    .toUpperCase() || "";
}

/**
 * Reconcile an authoritative, SOM-coded curriculum import.
 *
 * Matching rows keep their ids and learning evidence, while the official
 * wording, code and lecture link replace malformed parser output. Stale rows
 * from an earlier standalone-objectives import are removed. Objectives
 * extracted from lecture files remain untouched.
 */
export function reconcileOfficialObjectives(existing = [], incoming = []) {
  const evidenceScore = (row) => {
    const status = { mastered: 300, developing: 200, struggling: 100, untested: 0 }[row?.status] || 0;
    return status + Number(row?.attempts || row?.attemptCount || 0) * 10 + Number(row?.correctCount || 0);
  };
  const oldByCode = new Map();
  const uncoded = [];
  for (const row of existing) {
    const code = canonicalObjectiveCode(row);
    if (!code) { uncoded.push(row); continue; }
    const rows = oldByCode.get(code) || [];
    rows.push(row);
    oldByCode.set(code, rows);
  }

  const incomingByCode = new Map();
  for (const row of incoming) {
    const code = canonicalObjectiveCode(row);
    if (code && !incomingByCode.has(code)) incomingByCode.set(code, row);
  }

  const next = [...uncoded];
  let added = 0;
  let updated = 0;
  let removed = existing.length - uncoded.length;
  for (const [code, fresh] of incomingByCode) {
    const candidates = oldByCode.get(code) || [];
    const old = candidates.sort((a, b) => evidenceScore(b) - evidenceScore(a))[0];
    if (!old) {
      added++;
      next.push(fresh);
      continue;
    }
    removed--;
    const merged = {
      ...old,
      ...fresh,
      id: old.id || fresh.id,
      status: old.status || fresh.status || "untested",
      ...(old.personalNotes ? { personalNotes: old.personalNotes } : {}),
    };
    const changed = String(old.objective || old.text || "") !== String(fresh.objective || fresh.text || "")
      || canonicalObjectiveCode(old) !== code
      || old.linkedLecId !== fresh.linkedLecId;
    if (changed) updated++;
    next.push(merged);
  }
  return { objectives: next, added, updated, removed };
}
