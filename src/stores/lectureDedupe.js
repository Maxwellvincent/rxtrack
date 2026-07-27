/**
 * Duplicate lectures: why they exist, and how to collapse them.
 *
 * Re-uploading a lecture mints a fresh uuid and the upload path filters the old
 * row out of localStorage — but the push never deletes cloud lecture docs and
 * the pull re-adds every one, so the superseded copy comes back on the next
 * reload. Four identical "Lecture 01 - Endocrine System" rows, uploaded minutes
 * apart, are what that looks like from the outside.
 *
 * Pure planning only: callers apply the plan and own the deletes.
 */

/**
 * Same lecture, re-uploaded: same block, same type, same number AND the same
 * title/file.
 *
 * The title is not optional garnish here. Block+type+number alone collapses
 * genuinely different lectures — this data has several distinct "LEC 1" entries
 * per block (e.g. "Population Genetics" and "Population Genetics, Genotype &
 * Allele Frequency, Drift, Founder Effect"). A real duplicate is the same file
 * uploaded twice, so it matches on name as well.
 */
export function lectureKey(lecture) {
  if (!lecture?.blockId) return null;
  const type = String(lecture.lectureType || "LEC").trim();
  const number = lecture.lectureNumber;
  const slot = number != null && String(number).trim() !== "" ? String(number).trim() : "";
  const name = String(lecture.lectureTitle || lecture.fileName || lecture.filename || "")
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "");
  if (!name) return null; // nothing to distinguish it by — never dedupe blind
  return `${lecture.blockId}|${type}|${slot}|${name}`;
}

/** Objective ids pointing at each lecture id, across every block. */
function linkCounts(objectivesStore) {
  const counts = {};
  for (const entry of Object.values(objectivesStore || {})) {
    const flat = Array.isArray(entry) ? entry : [...(entry?.imported || []), ...(entry?.extracted || [])];
    for (const o of flat) {
      if (o?.linkedLecId) counts[o.linkedLecId] = (counts[o.linkedLecId] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Which copy survives: the one with the most lecture CONTENT.
 *
 * Content ranks above objective links because links are re-pointed by this
 * plan anyway, while text is not recoverable — several of these duplicate sets
 * have a heavily-linked copy holding 617 characters next to an unlinked copy
 * holding 22,000. Atoms are likewise not lost: `carryAtomsFrom` moves them onto
 * the survivor.
 *
 * @param {object} opts.contentSizes bytes of lecture text per lecture id
 */
export function pickSurvivor(group, { links = {}, atomIds = new Set(), contentSizes = {} } = {}) {
  const size = (l) => contentSizes[l.id] ?? (l.chunks || []).length;
  return [...group].sort((a, b) => {
    const byContent = size(b) - size(a);
    if (byContent) return byContent;
    const byAtoms = (atomIds.has(b.id) ? 1 : 0) - (atomIds.has(a.id) ? 1 : 0);
    if (byAtoms) return byAtoms;
    const byLinks = (links[b.id] || 0) - (links[a.id] || 0);
    if (byLinks) return byLinks;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  })[0];
}

/**
 * @returns {{ groups: object[], drop: string[], relink: object[], lectures: object[] }}
 *   `relink` re-points objectives off the dropped ids so no objective is
 *   orphaned by the cleanup — the whole point of keeping the richest copy.
 */
export function planLectureDedupe(lectures, { objectives = {}, atomIds = new Set(), contentSizes = {} } = {}) {
  const links = linkCounts(objectives);
  const byKey = new Map();
  for (const lecture of lectures || []) {
    const key = lectureKey(lecture);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(lecture);
  }

  const groups = [];
  const drop = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const keep = pickSurvivor(group, { links, atomIds, contentSizes });
    const dropped = group.filter((l) => l.id !== keep.id);
    groups.push({
      key,
      keep: keep.id,
      title: keep.lectureTitle || keep.fileName || key,
      drop: dropped.map((l) => l.id),
      keptLinks: links[keep.id] || 0,
      // Atoms cost an AI call — move them onto the survivor rather than delete them.
      carryAtomsFrom: atomIds.has(keep.id) ? null : dropped.find((l) => atomIds.has(l.id))?.id ?? null,
    });
    drop.push(...dropped.map((l) => l.id));
  }

  const dropSet = new Set(drop);
  const relink = [];
  for (const [blockId, entry] of Object.entries(objectives || {})) {
    const flat = Array.isArray(entry) ? entry : [...(entry?.imported || []), ...(entry?.extracted || [])];
    for (const o of flat) {
      if (!o?.linkedLecId || !dropSet.has(o.linkedLecId)) continue;
      const group = groups.find((g) => g.drop.includes(o.linkedLecId));
      if (group) relink.push({ blockId, objectiveId: o.id, from: o.linkedLecId, to: group.keep });
    }
  }

  return { groups, drop, relink, lectures: (lectures || []).filter((l) => !dropSet.has(l.id)) };
}

/** Apply the planned relinks to an objectives map, leaving everything else alone. */
export function applyRelinks(objectivesStore, relink) {
  if (!relink?.length) return objectivesStore;
  const byBlock = new Map();
  for (const r of relink) {
    if (!byBlock.has(r.blockId)) byBlock.set(r.blockId, new Map());
    byBlock.get(r.blockId).set(r.objectiveId, r.to);
  }

  const next = {};
  for (const [blockId, entry] of Object.entries(objectivesStore || {})) {
    const moves = byBlock.get(blockId);
    if (!moves) { next[blockId] = entry; continue; }
    const fix = (o) =>
      moves.has(o?.id) ? { ...o, linkedLecId: moves.get(o.id), sourceFile: moves.get(o.id) } : o;
    next[blockId] = Array.isArray(entry)
      ? entry.map(fix)
      : Object.fromEntries(
          Object.entries(entry).map(([k, v]) => [k, Array.isArray(v) ? v.map(fix) : v])
        );
  }
  return next;
}
