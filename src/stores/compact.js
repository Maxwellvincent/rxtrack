/**
 * localStorage compaction for the objectives store.
 *
 * The store sat at 4.86MB against a ~5MB browser quota, which is what made
 * writes start throwing. Everything here is byte-for-byte recoverable at read
 * time — a duplicate of another field, an empty value, or a guide string that
 * `guideFor` regenerates from bloom_level — except the block deletion, which is
 * opt-in and reports exactly what it removed.
 */
import { GUIDE_FIELDS, isDefaultGuide } from "../objectiveGuides.js";

/** Objective entries keep their storage shape: array, or {imported, extracted}. */
function mapEntry(entry, fn) {
  if (Array.isArray(entry)) return entry.map(fn);
  if (!entry || typeof entry !== "object") return entry;
  const next = { ...entry };
  for (const key of Object.keys(next)) {
    if (Array.isArray(next[key])) next[key] = next[key].map(fn);
  }
  return next;
}

/**
 * Strip from one objective:
 *  - `text` when it is the same sentence as `objective` (readers use
 *    `objective || text`, so the copy is dead weight)
 *  - null / empty-string fields, which read back identically when absent
 *  - guide fields whose value is exactly the Bloom-level default
 * A non-canonical guide, or a `text` that differs, is left alone.
 */
export function compactObjective(objective) {
  if (!objective || typeof objective !== "object") return objective;
  const next = {};
  for (const [key, value] of Object.entries(objective)) {
    if (value === null || value === "") continue;
    if (key === "text" && objective.objective && String(value).trim() === String(objective.objective).trim()) continue;
    if (GUIDE_FIELDS.includes(key) && isDefaultGuide(objective, key)) continue;
    next[key] = value;
  }
  return next;
}

/**
 * Compact a whole `rxt-block-objectives` map.
 *
 * @param {object} store
 * @param {string[]} [dropBlocks] block keys to delete outright
 * @returns {{ next: object, stats: object }} stats carry before/after bytes and
 *   the dropped blocks, so a caller can report what a run actually saved.
 */
export function compactObjectivesStore(store, { dropBlocks = [] } = {}) {
  const before = JSON.stringify(store || {}).length;
  const next = {};
  const dropped = [];

  for (const [blockId, entry] of Object.entries(store || {})) {
    if (dropBlocks.includes(blockId)) {
      dropped.push({ blockId, bytes: JSON.stringify(entry).length });
      continue;
    }
    next[blockId] = mapEntry(entry, compactObjective);
  }

  const after = JSON.stringify(next).length;
  return {
    next,
    stats: { before, after, saved: before - after, dropped },
  };
}

const flatEntry = (entry) =>
  Array.isArray(entry) ? entry : [...(entry?.imported || []), ...(entry?.extracted || [])];

/** Any rating, link, or test stamp counts as progress worth keeping. */
export function hasProgress(entry) {
  return flatEntry(entry).some(
    (o) => (o?.status && o.status !== "untested") || o?.linkedLecId || o?.lastTested
  );
}

/**
 * A block is safe to drop when another block holds every one of its objective
 * ids and it carries no progress of its own — the case that made `ftm2_default`
 * a dead copy of `ftm2`.
 */
export function isRedundantBlock(store, blockId, keepBlockId) {
  const candidate = flatEntry(store?.[blockId]);
  const keeper = flatEntry(store?.[keepBlockId]);
  if (!candidate.length || !keeper.length) return false;

  const keeperIds = new Set(keeper.map((o) => o?.id));
  const allCovered = candidate.every((o) => keeperIds.has(o?.id));
  return allCovered && !hasProgress(store?.[blockId]);
}

/**
 * The block a drop candidate is a copy OF. Objective ids are NOT block-scoped in
 * this data — the same imported set was written under several block keys — so id
 * coverage alone is weak evidence and an exact id-set match wins. A candidate
 * carrying progress of its own has no keeper at all.
 *
 * @returns {{ keeper: string|null, exact: boolean, candidates: string[] }}
 */
export function findKeeperFor(store, blockId) {
  if (hasProgress(store?.[blockId])) return { keeper: null, exact: false, candidates: [] };

  const candidateIds = new Set(flatEntry(store?.[blockId]).map((o) => o?.id));
  if (!candidateIds.size) return { keeper: null, exact: false, candidates: [] };

  const covering = [];
  let exactMatch = null;
  for (const other of Object.keys(store || {})) {
    if (other === blockId) continue;
    const otherIds = new Set(flatEntry(store[other]).map((o) => o?.id));
    if (!otherIds.size) continue;
    if (![...candidateIds].every((id) => otherIds.has(id))) continue;
    covering.push(other);
    if (otherIds.size === candidateIds.size && !exactMatch) exactMatch = other;
  }

  return { keeper: exactMatch ?? covering[0] ?? null, exact: !!exactMatch, candidates: covering };
}
