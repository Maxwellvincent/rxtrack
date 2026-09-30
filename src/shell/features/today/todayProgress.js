function checkedKey(blockId, now = new Date()) {
  return `rxt-checked-${blockId}-${now.toDateString()}`;
}

export function readChecked(blockId, now = new Date()) {
  try {
    const key = checkedKey(blockId, now);
    // Session storage is the writable fallback when an oversized local cache
    // has exhausted its quota. Prefer it when present because it may contain a
    // newer successful write than localStorage.
    const sessionSaved = sessionStorage.getItem(key);
    const saved = sessionSaved || localStorage.getItem(key);
    if (!sessionSaved && saved) {
      try { sessionStorage.setItem(key, saved); } catch { /* memory state still works */ }
    }
    return new Set(JSON.parse(saved || "[]"));
  } catch {
    return new Set();
  }
}

export function writeChecked(blockId, set, now = new Date()) {
  const key = checkedKey(blockId, now);
  const value = JSON.stringify([...(set || [])]);
  try { localStorage.setItem(key, value); } catch { /* full browser cache */ }
  try { sessionStorage.setItem(key, value); } catch { /* retain in-memory state */ }
}

/** Persist completion even when Today is unmounted behind LectureStudyFlow. */
export function markTodayLectureComplete(blockId, lectureId, now = new Date()) {
  if (!blockId || !lectureId) return readChecked(blockId, now);
  const next = readChecked(blockId, now);
  next.add(lectureId);
  writeChecked(blockId, next, now);
  return next;
}

/** A reset starts a fresh unchecked queue without erasing today's completion evidence. */
export function buildResetFocusPlan(candidateIds = [], checkedIds = [], limit = 3) {
  const completed = new Set(checkedIds.filter(Boolean));
  return [...new Set(candidateIds.filter((id) => id && !completed.has(id)))].slice(0, Math.max(0, Number(limit) || 0));
}
