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
  const sessions = value || fallback;
  const compact = (session, turnLimit, responseLimit) => {
    if (!session || typeof session !== "object") return session;
    const turns = Array.isArray(session.turns) ? session.turns : [];
    const objectiveStartedIds = [...new Set([
      ...(session.objectiveStartedIds || []),
      ...turns.map((turn) => String(turn?.objectiveId || "")),
    ].filter(Boolean).map(String))];
    const trimmedTurns = turns.slice(-turnLimit).map((turn) => ({
      ...turn,
      response: String(turn?.response || "").slice(0, responseLimit),
      feedback: String(turn?.feedback || "").slice(0, 500),
      followUp: String(turn?.followUp || "").slice(0, 300),
    }));
    const profile = session.learnerProfile || {};
    return {
      ...session,
      objectiveStartedIds,
      turns: trimmedTurns,
      learnerProfile: {
        ...profile,
        confirmedAnchors: (profile.confirmedAnchors || []).slice(-10).map((entry) => ({ ...entry, response: String(entry.response || "").slice(0, responseLimit) })),
        recentMisses: (profile.recentMisses || []).slice(-10).map((entry) => ({ ...entry, repairLink: String(entry.repairLink || "").slice(0, 180) })),
        confidenceEvents: (profile.confidenceEvents || []).slice(-16),
        reasoningSkillEvidence: (profile.reasoningSkillEvidence || []).slice(-24),
      },
    };
  };
  const attempt = (turnLimit, responseLimit) => {
    const packed = Object.fromEntries(Object.entries(sessions).map(([lectureId, session]) => [lectureId, compact(session, turnLimit, responseLimit)]));
    try {
      writeJson(userId, key, packed);
      return true;
    } catch (error) {
      if (error?.name !== "QuotaExceededError" && error?.code !== 22 && error?.code !== 1014) throw error;
      return false;
    }
  };
  if (attempt(16, 700)) return true;
  if (attempt(6, 300)) return true;
  // Keep the most recent per-lecture checkpoint and discard only verbose conversational
  // history. Objective state, current case, blockers, and learner-profile signals remain.
  if (attempt(2, 120)) return true;
  return false;
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
  if (!write(userId, next)) return null;
  return next;
}

export function clear(userId, lectureId) {
  if (!lectureId) return read(userId);
  const { [lectureId]: _removed, ...rest } = read(userId);
  write(userId, rest);
  return rest;
}
