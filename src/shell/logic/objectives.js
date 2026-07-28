/**
 * SP1 T1.1 — objectives logic, extracted from App.jsx.
 *
 * Two layers, deliberately separated:
 *
 *  1. PURE REDUCERS + ROLLUPS — flat objective array in, flat array (or a
 *     summary) out. No localStorage, no React, no App import, no clock unless
 *     a `now` is passed in explicitly.
 *  2. COMMAND HANDLERS — `createObjectiveCommands({ read, write, now, notify })`.
 *     Effects are injected, so a test can assert the exact write-set a command
 *     produces without touching storage.
 *
 * Behavior is ported 1:1 from App.jsx (`getMSKObjectives`, `saveMSKObjectives`,
 * `updateSingleObjectiveStatus`, `assignObjectiveToLecture`, …). Where App had a
 * quirk that data depends on — the legacy `msk` storage slot, the
 * imported/extracted bucket preservation — it is reproduced here, not cleaned up.
 */

// ── Storage shape (pure) ─────────────────────────────────────────────

/** Read the raw entry for a block. Legacy "msk" slot only when blockId is msk. */
export function readEntry(store, blockId) {
  if (!store || typeof store !== "object") return null;
  if (blockId == null || blockId === "") return null;
  if (store[blockId] !== undefined) return store[blockId];
  if (blockId === "msk" && store.msk !== undefined) return store.msk;
  return null;
}

/** Key to write a block's objectives under — preserves the existing slot. */
export function storageKeyFor(store, blockId) {
  if (!store || typeof store !== "object") return blockId;
  if (blockId == null || blockId === "") return blockId;
  if (store[blockId] !== undefined) return blockId;
  if (blockId === "msk" && store.msk !== undefined) return "msk";
  return blockId;
}

/** Flatten one entry: array, { imported, extracted, … }, or numeric-keyed {0:{…}}. */
export function flattenEntry(entry) {
  if (entry == null) return [];
  if (Array.isArray(entry)) return [...entry];
  const values = Object.values(entry);
  if (values.length === 0) return [];
  if (Array.isArray(values[0])) return values.filter(Array.isArray).flat();
  if (values[0] && typeof values[0] === "object" && values[0].id != null) {
    return values.filter((v) => v && typeof v === "object" && v.id != null);
  }
  const out = [];
  values.forEach((val) => { if (Array.isArray(val)) out.push(...val); });
  return out;
}

/** Drop duplicate ids, keeping first occurrence. Id-less entries are all kept. */
export function dedupeById(objectives) {
  const seen = new Set();
  const out = [];
  for (const o of objectives || []) {
    if (!o || typeof o !== "object") continue;
    if (o.id == null) { out.push(o); continue; }
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

/**
 * Fold a flat list back into an entry, preserving the existing storage shape.
 * The codebase migrated from a flat legacy array to { imported, extracted };
 * writing an array over an object destroys the buckets, so items stay in
 * whichever bucket they came from and brand-new items go to `extracted`.
 */
export function toEntry(existingEntry, nextFlat) {
  const deduped = dedupeById(nextFlat);
  if (existingEntry && typeof existingEntry === "object" && !Array.isArray(existingEntry)) {
    const importedIds = new Set(
      (Array.isArray(existingEntry.imported) ? existingEntry.imported : [])
        .map((o) => o?.id)
        .filter(Boolean)
    );
    const imported = [];
    const extracted = [];
    for (const o of deduped) {
      if (o?.id && importedIds.has(o.id)) imported.push(o);
      else extracted.push(o);
    }
    return { ...existingEntry, imported, extracted };
  }
  return deduped;
}

/**
 * The de-dupe the UI list uses (App's `getBlockObjectives` /
 * `readBlockObjectivesDedupedFromStorage`): same first-60-chars of text after
 * lowercasing and stripping non-word chars = same objective. Text-less rows are
 * dropped, exactly as App dropped them.
 */
export function dedupeByText(objectives) {
  const seen = new Set();
  return (objectives || []).filter((obj) => {
    const key = (obj?.objective || obj?.text || "")
      .slice(0, 60)
      .toLowerCase()
      .replace(/\W/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Flat objective list for a block, straight off a store map. */
export function selectBlockObjectives(store, blockId) {
  return flattenEntry(readEntry(store, blockId));
}

// ── Pure reducers ────────────────────────────────────────────────────

/** Patch one objective by id. Unknown id → list returned unchanged. */
export function updateObjective(objectives, objId, patch) {
  const list = objectives || [];
  const idx = list.findIndex((o) => o?.id === objId);
  if (idx === -1) return list;
  const next = [...list];
  next[idx] = { ...next[idx], ...patch };
  return next;
}

/**
 * Status change from the UI. Mirrors App's `updateSingleObjectiveStatus`:
 * stamps both lastUpdated and lastTested, and lastDrilled only when asked.
 */
export function setStatus(objectives, objId, status, now, { includeLastDrilled = false } = {}) {
  return updateObjective(objectives, objId, {
    status,
    lastUpdated: now,
    lastTested: now,
    ...(includeLastDrilled ? { lastDrilled: now } : {}),
  });
}

/** Self-rating from the UI — status + lastTested only (App's `onSelfRate`). */
export function selfRate(objectives, objId, status, now) {
  return updateObjective(objectives, objId, { status, lastTested: now });
}

/** Link an objective to a lecture, marking it manually aligned. */
export function assignToLecture(objectives, objId, lecId, now) {
  if (!objId || !lecId) return objectives || [];
  return updateObjective(objectives, objId, {
    linkedLecId: lecId,
    sourceFile: lecId,
    manuallyAligned: true,
    alignedAt: now,
  });
}

/**
 * Bulk link. App's bulk paths set no `alignedAt` — kept as-is so a bulk assign
 * stays distinguishable from a single one in existing data.
 */
export function assignManyToLecture(objectives, objIds, lecId) {
  if (!lecId || !objIds?.length) return objectives || [];
  const ids = new Set(objIds);
  return (objectives || []).map((o) =>
    ids.has(o?.id)
      ? { ...o, linkedLecId: lecId, sourceFile: lecId, manuallyAligned: true }
      : o
  );
}

/** Unlink an objective from its lecture. */
export function removeLectureLink(objectives, objId) {
  if (!objId) return objectives || [];
  return updateObjective(objectives, objId, { linkedLecId: null, sourceFile: null });
}

/** Delete by id. */
export function deleteObjectives(objectives, objIds) {
  if (!objIds?.length) return objectives || [];
  const ids = new Set(objIds);
  return (objectives || []).filter((o) => !ids.has(o?.id));
}

/** App's note-matching key: first 55 chars, lowercased, non-word stripped. */
function noteKey(text) {
  return String(text || "").slice(0, 55).toLowerCase().replace(/\W/g, "");
}

/**
 * Replace everything a previous extraction wrote for one lecture with a fresh
 * pass, which is what re-ingesting a lecture means. Objectives belonging to
 * other lectures are untouched, and a personal note written against an
 * objective survives when the same objective comes back — App carried notes
 * across a re-upload the same way, and losing them is real data loss.
 */
export function replaceLectureObjectives(objectives, lecId, incoming) {
  if (!lecId) return objectives || [];
  const list = objectives || [];
  const belongs = (o) => o?.linkedLecId === lecId || o?.sourceFile === lecId;

  const notes = new Map();
  for (const o of list) {
    if (!belongs(o) || !String(o?.personalNotes || "").trim()) continue;
    const k = noteKey(o.objective || o.text);
    if (k) notes.set(k, o.personalNotes);
  }

  const added = (incoming || []).map((o) => {
    const carried = notes.get(noteKey(o?.objective || o?.text));
    return {
      ...o,
      linkedLecId: lecId,
      sourceFile: lecId,
      ...(carried && !String(o?.personalNotes || "").trim() ? { personalNotes: carried } : {}),
    };
  });

  return [...list.filter((o) => !belongs(o)), ...added];
}

/** An objective counts as linked only when it points at a real lecture in the block. */
export function isLinked(objective, blockLectures) {
  const lid = objective?.linkedLecId;
  if (!lid || lid === "imported" || lid === "unknown") return false;
  return (blockLectures || []).some((l) => l.id === lid);
}

/** Drop every objective not linked to a lecture in this block. */
export function deleteUnlinked(objectives, blockLectures) {
  return (objectives || []).filter((o) => isLinked(o, blockLectures));
}

// ── Rollups (pure) ───────────────────────────────────────────────────

const MASTERED = "mastered";
const STRUGGLING = "struggling";
const IN_PROGRESS = "in_progress";

/** Counts per status bucket, with anything unrecognised counted as untested. */
export function statusCounts(objectives) {
  const list = objectives || [];
  const counts = { mastered: 0, in_progress: 0, struggling: 0, untested: 0, total: list.length };
  for (const o of list) {
    if (o?.status === MASTERED) counts.mastered += 1;
    else if (o?.status === STRUGGLING) counts.struggling += 1;
    else if (o?.status === IN_PROGRESS) counts.in_progress += 1;
    else counts.untested += 1;
  }
  return counts;
}

/** Mastered share, 0-100, rounded. Null when there is nothing to cover. */
export function coveragePct(objectives) {
  const { mastered, total } = statusCounts(objectives);
  if (!total) return null;
  return Math.round((mastered / total) * 100);
}

/** Objectives grouped by bloom level, each with its own status rollup. */
export function bloomRollup(objectives) {
  const byLevel = new Map();
  for (const o of objectives || []) {
    const level = o?.bloom_level ?? null;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(o);
  }
  return [...byLevel.entries()]
    .map(([level, list]) => ({
      level,
      name: list.find((o) => o?.bloom_level_name)?.bloom_level_name ?? null,
      counts: statusCounts(list),
      coverage: coveragePct(list),
    }))
    .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity));
}

/** How much of the block is actually wired to lectures. */
export function alignmentStats(objectives, blockLectures) {
  const list = objectives || [];
  const linked = list.filter((o) => isLinked(o, blockLectures));
  const byLecture = {};
  for (const o of linked) {
    byLecture[o.linkedLecId] = (byLecture[o.linkedLecId] || 0) + 1;
  }
  return {
    total: list.length,
    linked: linked.length,
    unlinked: list.length - linked.length,
    pct: list.length ? Math.round((linked.length / list.length) * 100) : null,
    byLecture,
  };
}

// ── Command handlers (effects injected) ──────────────────────────────

/**
 * Bind the reducers to a store.
 *
 * @param {object} deps
 * @param {() => object} deps.read   full `rxt-block-objectives` map
 * @param {(next: object) => void} deps.write  authoritative replace of that map
 * @param {() => string} [deps.now]  ISO timestamp source (injected for tests)
 * @param {() => void} [deps.notify] called after a successful write
 *
 * Every command returns the write-set it produced — `{ blockId, key, entry,
 * objectives }` — or `null` when the reducer changed nothing, so callers (and
 * tests) can assert on the effect without reading storage back.
 */
export function createObjectiveCommands({ read, write, now = () => new Date().toISOString(), notify }) {
  function apply(blockId, reduce) {
    if (blockId == null || blockId === "") return null;
    const store = read() || {};
    const key = storageKeyFor(store, blockId);
    const current = flattenEntry(readEntry(store, blockId));
    const next = reduce(current);
    if (next === current) return null;
    const entry = toEntry(store[key], next);
    write({ ...store, [key]: entry });
    notify?.();
    return { blockId, key, entry, objectives: next };
  }

  return {
    setStatus: (blockId, objId, status, opts) =>
      apply(blockId, (objs) => setStatus(objs, objId, status, now(), opts)),
    selfRate: (blockId, objId, status) =>
      apply(blockId, (objs) => selfRate(objs, objId, status, now())),
    updateObjective: (blockId, objId, patch) =>
      apply(blockId, (objs) => updateObjective(objs, objId, patch)),
    assignToLecture: (blockId, objId, lecId) =>
      apply(blockId, (objs) => assignToLecture(objs, objId, lecId, now())),
    assignManyToLecture: (blockId, objIds, lecId) =>
      apply(blockId, (objs) => assignManyToLecture(objs, objIds, lecId)),
    removeLectureLink: (blockId, objId) =>
      apply(blockId, (objs) => removeLectureLink(objs, objId)),
    deleteObjectives: (blockId, objIds) =>
      apply(blockId, (objs) => deleteObjectives(objs, objIds)),
    deleteUnlinked: (blockId, blockLectures) =>
      apply(blockId, (objs) => deleteUnlinked(objs, blockLectures)),
    replaceLectureObjectives: (blockId, lecId, incoming) =>
      apply(blockId, (objs) => replaceLectureObjectives(objs, lecId, incoming)),
  };
}
