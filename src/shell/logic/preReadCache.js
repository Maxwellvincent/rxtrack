/**
 * Pre-generated pre-reads.
 *
 * Building one costs a model round trip — measured at ~35s on the first call
 * through llm-bridge — and a pre-read is worth doing exactly when you have five
 * spare minutes, not when you have thirty-five seconds of staring first. So
 * Today generates tomorrow's pre-reads in the background while you work today,
 * and opening one is then instant.
 *
 * The cache is keyed by lecture and validated by a SIGNATURE of what the
 * pre-read was built from, not by time alone: uploading the lecture material to
 * a stub that previously had only objectives must throw the old questions away,
 * because those were generated from strictly less information.
 */
import { preReadSource } from "../features/lectures/preRead.js";

/** How many lectures may be pre-generated per pass. Work Ahead's horizon is two days. */
export const PREFETCH_LIMIT = 2;

/** A cached pre-read older than this is regenerated. */
export const TTL_DAYS = 14;

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * What this pre-read was built from. Cheap and deterministic: the source kind,
 * how much text there was, and which objectives existed.
 */
export function preReadSignature(lecture, objectives = []) {
  const source = preReadSource(lecture, objectives);
  const objIds = (objectives || []).map((o) => o?.id).filter(Boolean).sort().join(",");
  return [source.kind, String(source.text || "").length, objIds].join("|");
}

export function cacheEntry(lecture, objectives, generated, now = new Date()) {
  return {
    signature: preReadSignature(lecture, objectives),
    generatedAt: new Date(now).toISOString(),
    payload: generated,
  };
}

/** The cached pre-read for a lecture, or null when there is nothing usable. */
export function readCached(store, lecture, objectives = [], { now = new Date() } = {}) {
  const entry = store?.[lecture?.id];
  if (!entry?.payload) return null;
  if (entry.signature !== preReadSignature(lecture, objectives)) return null;

  const age = (new Date(now) - new Date(entry.generatedAt)) / DAY_MS;
  if (!Number.isFinite(age) || age > TTL_DAYS) return null;

  return entry.payload;
}

/**
 * Which of the offered lectures still need generating, newest-first order kept.
 * Capped so a background pass never fires off a queue of model calls.
 */
export function preReadsToGenerate(lectures = [], store = {}, { objectivesFor, now = new Date(), limit = PREFETCH_LIMIT } = {}) {
  const out = [];
  for (const ls of lectures) {
    const lec = ls?.lec ?? ls;
    if (!lec?.id) continue;
    if (readCached(store, lec, objectivesFor?.(lec.id) ?? [], { now })) continue;
    out.push(lec);
    if (out.length >= limit) break;
  }
  return out;
}
