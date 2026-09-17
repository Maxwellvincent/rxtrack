import { buildStyleFingerprint, exemplarSourceTier } from "./mcq.js";

export const STYLE_PROFILE_VERSION = 1;

/** Build a compact, cumulative style profile from every verified upload. */
export function buildStyleProfile(examples = [], { now = Date.now() } = {}) {
  const usable = (examples || []).filter((question) =>
    question?.stem && question?.choices && question.answerKeyVerified !== false
  );
  const official = usable.filter((question) => {
    const tier = exemplarSourceTier(question);
    return tier !== "homework" && tier !== "clicker" && !question.hasImage;
  });
  const sourceCounts = {};
  const optionCounts = {};
  for (const question of usable) {
    const source = exemplarSourceTier(question);
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    const count = Object.keys(question.choices || {}).length;
    optionCounts[count] = (optionCounts[count] || 0) + 1;
  }
  return {
    version: STYLE_PROFILE_VERSION,
    sampleSize: usable.length,
    sourceCounts,
    optionCounts,
    officialStyle: buildStyleFingerprint(official),
    homeworkStyle: buildStyleFingerprint(usable.filter((q) => exemplarSourceTier(q) === "homework")),
    clickerStyle: buildStyleFingerprint(usable.filter((q) => exemplarSourceTier(q) === "clicker")),
    updatedAt: now,
  };
}
