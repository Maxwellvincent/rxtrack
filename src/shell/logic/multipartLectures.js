import { cleanLectureTitle } from "../../lectureTitle.js";

/** Explicit part markers only: a shared number or 'Before NB 09' is insufficient. */
export function multipartIdentity(lecture = {}) {
  const filename = lecture.sourceFiles?.[0]?.filename || lecture.filename || lecture.fileName;
  const text = cleanLectureTitle(filename || lecture.lectureTitle);
  const match = text.match(/(?:\(\s*(\d+)\s*\)|\b(?:part|pt\.?)\s*[-:]?\s*(\d+|VIII|VII|VI|IV|III|II|IX|V|I))(?=\s*(?:[-–—]\s*(?:before|after)\b.*)?$)/i);
  if (!match) return null;
  const raw = (match[1] || match[2]).toUpperCase();
  const part = Number(raw) || ({ I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9 })[raw];
  const title = text.slice(0, match.index).replace(/^(?:[a-z]{2,5}\s+)?(?:DLA|LEC|LECTURE|SG|LAB|CLIN)\s*0*\d+[a-z]?\s*[-–—:]?\s*/i, "").replace(/\s*[-–—:]\s*$/, "").trim();
  // This spelling variation occurs in the two original NB DLA 03 filenames.
  const base = title.toLowerCase().replace(/\bneurotransmitters\b/g, "neurotransmitter").replace(/[^a-z0-9]+/g, " ").trim();
  if (!part || !base) return null;
  return { part, title, key: `${lecture.termId || ""}:${lecture.blockId || ""}:${lecture.lectureType || "LEC"}:${lecture.lectureNumber ?? ""}:${lecture.lectureSuffix || ""}:${base}` };
}

export function multipartGroups(lectures = []) {
  const groups = new Map();
  for (const lecture of lectures) {
    if (lecture.mergedInto || lecture.combinedParts > 1) continue;
    const identity = multipartIdentity(lecture);
    if (!identity) continue;
    const rows = groups.get(identity.key) || [];
    rows.push({ lecture, ...identity });
    groups.set(identity.key, rows);
  }
  return [...groups.values()].filter(rows => rows.length > 1 && rows.some(row => row.part === 1) && new Set(rows.map(row => row.part)).size === rows.length)
    .map(rows => rows.sort((a, b) => a.part - b.part).map(row => row.lecture));
}

export function relinkMultipartObjectives(entry, sourceIds, targetId) {
  const move = objective => sourceIds.includes(objective?.linkedLecId)
    ? { ...objective, originalLectureId: objective.originalLectureId || objective.linkedLecId, linkedLecId: targetId } : objective;
  return Array.isArray(entry) ? entry.map(move) : { ...entry, imported: (entry?.imported || []).map(move), extracted: (entry?.extracted || []).map(move) };
}

/** Read-only projection; original study records keep their source IDs. */
export function multipartHistory(lectures, history, blockId) {
  const next = { ...history };
  for (const lecture of lectures || []) {
    const ids = [...new Set([lecture.id, ...(lecture.mergedFrom || []).map(row => row.id)])];
    if (ids.length < 2) continue;
    const entries = ids.map(id => history?.[`${id}__${blockId}`]).filter(Boolean);
    if (!entries.length) continue;
    const unique = rows => [...new Map(rows.map(row => [row.id || JSON.stringify(row), row])).values()];
    const byRecency = [...entries].sort((a, b) => String(a.lastActivityDate || a.lastStudied || a.lastCompleted || a.completedDate || a.sessions?.[0]?.at || "").localeCompare(String(b.lastActivityDate || b.lastStudied || b.lastCompleted || b.completedDate || b.sessions?.[0]?.at || "")));
    next[`${lecture.id}__${blockId}`] = { ...byRecency.reduce((result, entry) => ({ ...result, ...entry }), {}),
      activityLog: unique(entries.flatMap(row => row.activityLog || [])),
      sessions: unique(entries.flatMap(row => row.sessions || [])).sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))),
    };
  }
  return next;
}
