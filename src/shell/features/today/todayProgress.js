function checkedKey(blockId, now = new Date()) {
  return `rxt-checked-${blockId}-${now.toDateString()}`;
}

export function readChecked(blockId, now = new Date()) {
  try {
    const key = checkedKey(blockId, now);
    const saved = localStorage.getItem(key);
    const legacy = sessionStorage.getItem(key);
    if (!saved && legacy) localStorage.setItem(key, legacy);
    return new Set(JSON.parse(saved || legacy || "[]"));
  } catch {
    return new Set();
  }
}

export function writeChecked(blockId, set, now = new Date()) {
  localStorage.setItem(checkedKey(blockId, now), JSON.stringify([...(set || [])]));
}

/** Persist completion even when Today is unmounted behind LectureStudyFlow. */
export function markTodayLectureComplete(blockId, lectureId, now = new Date()) {
  if (!blockId || !lectureId) return readChecked(blockId, now);
  const next = readChecked(blockId, now);
  next.add(lectureId);
  writeChecked(blockId, next, now);
  return next;
}
