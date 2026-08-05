function mergeSessions(cloud = [], local = []) {
  const all = [...(cloud || []), ...(local || [])];
  const seen = new Set();
  return all
    .filter((s) => {
      const bucket = Math.floor(new Date(s.date || s.startedAt || 0).getTime() / 90000);
      const key = `${s.sessionType || ""}__${s.lectureId || s.topicKey || ""}__${bucket}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.date || a.startedAt || 0) - new Date(b.date || b.startedAt || 0));
}

export function mergePerformance(cloud = {}, local = {}) {
  const result = { ...(cloud || {}) };
  for (const [key, localEntry] of Object.entries(local || {})) {
    if (!result[key]) {
      result[key] = localEntry;
    } else {
      const mergedSessions = mergeSessions(result[key].sessions, localEntry.sessions);
      const scores = mergedSessions.map((s) => s.score).filter((s) => typeof s === "number");
      result[key] = {
        ...result[key],
        ...localEntry,
        sessions: mergedSessions.slice(-50),
        score: scores.length
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : result[key].score ?? localEntry.score,
      };
    }
  }
  return result;
}

export function mergeCompletion(cloud = {}, local = {}) {
  const result = { ...(cloud || {}) };
  for (const [key, localEntry] of Object.entries(local || {})) {
    if (!result[key]) {
      result[key] = localEntry;
    } else {
      const cloudEntry = result[key];
      const cloudTs = cloudEntry.lastActivityDate ? new Date(cloudEntry.lastActivityDate).getTime() : 0;
      const localTs = localEntry.lastActivityDate ? new Date(localEntry.lastActivityDate).getTime() : 0;
      const newer = localTs >= cloudTs ? localEntry : cloudEntry;
      const logMap = new Map();
      [
        ...(Array.isArray(cloudEntry.activityLog) ? cloudEntry.activityLog : []),
        ...(Array.isArray(localEntry.activityLog) ? localEntry.activityLog : []),
      ].forEach((e) => {
        if (!e) return;
        const id = e.id || `${e.date || ""}|${e.activityType || ""}|${e.confidenceRating || ""}`;
        const existing = logMap.get(id);
        if (!existing || new Date(e.date || 0) >= new Date(existing.date || 0)) logMap.set(id, e);
      });
      result[key] = {
        ...cloudEntry,
        ...localEntry,
        completionLevel: Math.max(cloudEntry.completionLevel || 0, localEntry.completionLevel || 0),
        reviewDates: Array.isArray(newer.reviewDates)
          ? newer.reviewDates
          : (cloudEntry.reviewDates || localEntry.reviewDates || []),
        lastActivityDate: newer.lastActivityDate || cloudEntry.lastActivityDate || localEntry.lastActivityDate,
        lastConfidence: newer.lastConfidence || cloudEntry.lastConfidence || localEntry.lastConfidence,
        firstCompletedDate:
          cloudEntry.firstCompletedDate || localEntry.firstCompletedDate || newer.firstCompletedDate,
        activityLog: Array.from(logMap.values()).sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0)),
      };
    }
  }
  return result;
}

export function mergeBlockObjectives(cloud, local) {
  if (!cloud) return local;
  if (!local) return cloud;
  const cloudById = {};
  (cloud.imported || []).forEach((o) => { if (o.id) cloudById[o.id] = o; });
  const localById = {};
  (local.imported || []).forEach((o) => { if (o.id) localById[o.id] = o; });
  const imported = [];
  for (const id of new Set([...Object.keys(cloudById), ...Object.keys(localById)])) {
    const c = cloudById[id];
    const l = localById[id];
    if (!c) imported.push(l);
    else if (!l) imported.push(c);
    else imported.push((l.drillCount || 0) >= (c.drillCount || 0) ? { ...c, ...l } : { ...l, ...c });
  }
  const extractedIds = new Set([...(cloud.extracted || []).map((e) => e.id || e), ...(local.extracted || []).map((e) => e.id || e)]);
  const extracted = [...(cloud.extracted || []), ...(local.extracted || [])].filter((e) => {
    const id = e.id || e;
    if (!extractedIds.has(id)) return false;
    extractedIds.delete(id);
    return true;
  });
  return { ...cloud, ...local, imported, extracted };
}

export function mergeObjectivesMap(cloud = {}, local = {}) {
  const result = { ...(cloud || {}) };
  for (const [blockId, entry] of Object.entries(local || {})) {
    result[blockId] = mergeBlockObjectives(result[blockId] ?? null, entry);
  }
  return result;
}

export function mergeWeakConcepts(cloud = {}, local = {}) {
  const result = {};
  const allBlocks = new Set([...Object.keys(cloud || {}), ...Object.keys(local || {})]);
  for (const blockId of allBlocks) {
    const byId = {};
    [...(cloud[blockId] || []), ...(local[blockId] || [])].forEach((c) => {
      const id = c?.id || c?.concept;
      if (!id) return;
      if (!byId[id] || (c.missCount || 0) > (byId[id].missCount || 0)) byId[id] = c;
    });
    result[blockId] = Object.values(byId);
  }
  return result;
}

export function mergeTerms(cloud, local) {
  if (!cloud) return local;
  if (!local) return cloud;
  if (!Array.isArray(cloud) || !Array.isArray(local)) return local ?? cloud;
  const byId = {};
  [...cloud, ...local].forEach((t) => {
    if (!t?.id) return;
    if (!byId[t.id]) { byId[t.id] = t; return; }
    const existingBlocks = byId[t.id].blocks || [];
    const blockIds = new Set(existingBlocks.map((b) => b.id));
    byId[t.id] = {
      ...byId[t.id],
      ...t,
      blocks: [...existingBlocks, ...(t.blocks || []).filter((b) => !blockIds.has(b.id))],
    };
  });
  return Object.values(byId);
}

export function mergeByIdArray(cloud = [], local = []) {
  if (!Array.isArray(cloud) || !Array.isArray(local)) return local ?? cloud ?? [];
  const byId = {};
  [...cloud, ...local].forEach((item) => {
    const id = item?.id;
    if (id) byId[id] = { ...(byId[id] || {}), ...item };
  });
  const mergedIds = new Set(Object.keys(byId));
  return [
    ...Object.values(byId),
    ...[...cloud, ...local].filter((item) => !item?.id && !mergedIds.has(JSON.stringify(item))),
  ];
}

export function mergeKvValue(cloud, local) {
  if (cloud == null) return local;
  if (local == null) return cloud;
  if (Array.isArray(cloud) && Array.isArray(local)) {
    const hasIds = local.every((x) => x && typeof x === "object" && x.id);
    if (hasIds) return mergeByIdArray(cloud, local);
    const seen = new Set(cloud.map((x) => JSON.stringify(x)));
    return [...cloud, ...local.filter((x) => !seen.has(JSON.stringify(x)))];
  }
  if (typeof cloud === "object" && typeof local === "object" && !Array.isArray(cloud) && !Array.isArray(local)) {
    const result = { ...cloud };
    for (const [k, v] of Object.entries(local)) result[k] = k in result ? mergeKvValue(result[k], v) : v;
    return result;
  }
  return local;
}

/**
 * Furthest-round-wins, per lecture.
 *
 * Study progress is monotonic by definition — you cannot un-answer a question — so the higher
 * round is always the truer one and the two devices can never really conflict. Timestamps are
 * carried for display only; they deliberately do not decide the winner, because a phone that
 * reopened a lecture later has not therefore studied more of it.
 */
export function mergeRoundProgress(cloud, local) {
  const out = {};
  for (const side of [cloud || {}, local || {}]) {
    for (const [lectureId, entry] of Object.entries(side)) {
      const round = entry?.round;
      if (!Number.isInteger(round) || round <= 0) continue;
      if (!out[lectureId] || round > out[lectureId].round) {
        out[lectureId] = { round, at: entry.at ?? Date.now() };
      }
    }
  }
  return out;
}

/**
 * Union of answered questions, per block.
 *
 * Calibration is an append-only log, so merging is a set union rather than a choice between
 * copies. Identity is the concept plus the moment it was answered: the same concept twice at
 * different times is a retest and both belong in the curve, while the same concept at the same
 * timestamp is one answer that reached both devices.
 */
export function mergeCalibration(cloud, local) {
  const out = {};
  for (const side of [cloud || {}, local || {}]) {
    for (const [blockId, records] of Object.entries(side)) {
      if (!Array.isArray(records)) continue;
      const seen = new Set((out[blockId] || []).map((r) => `${r.ts}|${r.concept}`));
      const list = out[blockId] || (out[blockId] = []);
      for (const r of records) {
        if (!r || !r.concept || !Number.isFinite(r.ts)) continue;
        const id = `${r.ts}|${r.concept}`;
        if (seen.has(id)) continue;
        seen.add(id);
        list.push(r);
      }
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.ts - b.ts);
  return out;
}
