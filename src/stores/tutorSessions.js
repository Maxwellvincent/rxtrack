/**
 * Local checkpoint store for bounded, resumable lecture-tutor sessions.
 *
 * The session controller is deliberately pure; this adapter keeps the current
 * checkpoint available when the learner leaves a lecture or closes the app.
 * Cloud sync can be added later without changing the session state shape.
 */
import { readJson, writeJson } from "./base.js";

export const key = "rxt-tutor-sessions";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback) || fallback;
}

export function write(userId, value) {
  return writeJson(userId, key, value || fallback);
}

export function get(userId, lectureId) {
  if (!lectureId) return null;
  return read(userId)[lectureId] || null;
}

export function getLearnerProfile(userId) {
  const profiles = Object.values(read(userId)).map((session) => session?.learnerProfile).filter(Boolean);
  const collect = (key, limit) => [...new Map(profiles.flatMap((profile) => profile[key] || [])
    .map((entry) => [JSON.stringify(entry), entry])).values()]
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .slice(-limit);
  const reasoningSkillEvidence = collect("reasoningSkillEvidence", 40);
  const stableReasoningSkills = [...new Set(reasoningSkillEvidence
    .filter((entry) => reasoningSkillEvidence.some((other) => other.skill === entry.skill && other.objectiveId !== entry.objectiveId))
    .map((entry) => entry.skill))];
  return {
    confirmedAnchors: collect("confirmedAnchors", 16),
    recentMisses: collect("recentMisses", 16),
    confidenceEvents: collect("confidenceEvents", 32),
    reasoningSkillEvidence,
    stableReasoningSkills,
  };
}

export function save(userId, state) {
  if (!state?.lectureId) return read(userId);
  const next = { ...read(userId), [state.lectureId]: state };
  write(userId, next);
  return next;
}

export function clear(userId, lectureId) {
  if (!lectureId) return read(userId);
  const { [lectureId]: _removed, ...rest } = read(userId);
  write(userId, rest);
  return rest;
}
