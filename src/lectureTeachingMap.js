/**
 * Teaching maps live in Firestore; localStorage keeps a stub.
 *
 * A map is a few KB of prose per lecture — a clinical hook, several sections of
 * core content, anchor questions. That is small until it is not: 24 lectures put
 * 231KB into rxt-lec-meta and the block after it would have added as much again,
 * against a ~5MB budget already carrying the objectives.
 *
 * The stub is what the lecture LIST needs — whether a map exists and how big it
 * is, for the "N sections mapped" badge. The body is what DeepLearn needs, and
 * DeepLearn is opened deliberately, one block at a time, so fetching then is
 * cheap and Firestore serves repeats from its own cache.
 */

/** Enough to render the badge without holding the map. */
export function teachingMapStub(map) {
  if (!map?.sections?.length) return null;
  return {
    sections: map.sections.length,
    hasHook: !!map.clinicalHook,
  };
}

/** The lecture row as it should be stored locally: stub in, body out. */
export function stripTeachingMap(lecture) {
  if (!lecture?.teachingMap) return lecture;
  const { teachingMap, ...rest } = lecture;
  const stub = teachingMapStub(teachingMap);
  return stub ? { ...rest, teachingMapMeta: stub } : rest;
}

/** True when this lecture has a map worth fetching. */
export function hasTeachingMap(lecture) {
  return !!(lecture?.teachingMap?.sections?.length || lecture?.teachingMapMeta?.sections);
}

/** Section count for the badge, whichever form the row is in. */
export function teachingMapSectionCount(lecture) {
  return lecture?.teachingMap?.sections?.length ?? lecture?.teachingMapMeta?.sections ?? 0;
}

/**
 * Fold fetched maps back onto the lecture rows DeepLearn is handed.
 *
 * A row that already carries its map keeps it — a map generated this session has
 * not necessarily reached the cloud yet.
 */
export function withTeachingMaps(lectures, mapsById) {
  if (!mapsById || !Object.keys(mapsById).length) return lectures || [];
  return (lectures || []).map((lec) =>
    lec?.teachingMap || !mapsById[lec?.id] ? lec : { ...lec, teachingMap: mapsById[lec.id] }
  );
}

/**
 * Fetch the maps for the lectures that have one, skipping those already loaded.
 * `fetchContent` is injected so this stays testable without Firestore.
 */
export async function fetchTeachingMaps(userId, lectures, fetchContent) {
  if (!userId) return {};
  const wanted = (lectures || []).filter((l) => l?.id && !l.teachingMap && hasTeachingMap(l));
  const out = {};
  await Promise.all(
    wanted.map(async (lec) => {
      try {
        const content = await fetchContent(userId, lec.id);
        const map = content?.meta?.teachingMap;
        if (map?.sections?.length) out[lec.id] = map;
      } catch {
        // A lecture whose map cannot be fetched simply teaches without one.
      }
    })
  );
  return out;
}
