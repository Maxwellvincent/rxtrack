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
  const incomingByCode = new Map();
  const incomingByText = new Map();
  for (const row of incoming) {
    const code = canonicalObjectiveCode(row);
    if (code) incomingByCode.set(code, row);
    const key = textKey(row);
    if (key) incomingByText.set(key, row);
  }

  const matchedIncoming = new Set();
  const next = [];
  let updated = 0;
  let removed = 0;

  for (const old of existing) {
    const match = incomingByCode.get(canonicalObjectiveCode(old)) || incomingByText.get(textKey(old));
    if (match) {
      matchedIncoming.add(match);
      const merged = {
        ...old,
        ...match,
        id: old.id || match.id,
        status: old.status || match.status || "untested",
        ...(old.personalNotes ? { personalNotes: old.personalNotes } : {}),
      };
      const changed = String(old.objective || old.text || "") !== String(match.objective || match.text || "")
        || canonicalObjectiveCode(old) !== canonicalObjectiveCode(match)
        || old.linkedLecId !== match.linkedLecId;
      if (changed) updated++;
      next.push(merged);
      continue;
    }
    // A coded curriculum PDF is authoritative for the block. Early imports did
    // not persist extractionMethod, so malformed coded rows otherwise survive
    // forever beside their repaired replacements. Preserve uncoded/manual and
    // lecture-only objectives; replace the official SOM-coded set completely.
    if (old?.extractionMethod === "standalone-doc" || canonicalObjectiveCode(old)) {
      removed++;
      continue;
    }
    next.push(old);
  }

  const additions = incoming.filter((row) => !matchedIncoming.has(row));
  next.push(...additions);
  return { objectives: next, added: additions.length, updated, removed };
}
