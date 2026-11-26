// Map a block's saved score-report categories to lectures, objectives and
// keywords (reportTargets.js). One AI call per block; the matching and the
// write are deterministic. Runs after a report import and from the CBSE
// "Report targets" plan for reports imported before mapping existed.

import * as weakStore from "../../stores/weakConcepts.js";
import * as lecturesStore from "../../stores/lectures.js";
import * as objectivesStore from "../../stores/blockObjectives.js";
import * as schoolResultsStore from "../../stores/schoolResults.js";
import { flattenObjectiveEntry } from "../data.js";
import { buildReportTargetPrompt, matchCategoryTarget, normalizeReportTargets, withReportTarget } from "./reportTargets.js";

const norm = value => String(value || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();

/** Latest uploaded overall result for a block (the report the categories came from). */
export function latestBlockReport(results = {}, blockId) {
  return Object.values(results || {}).filter(result => result?.blockId === blockId).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

export async function mapReportTargets({ userId, blockId, now = new Date().toISOString() } = {}, deps = {}) {
  const readWeak = deps.readWeak || weakStore.read;
  const writeWeak = deps.writeWeak || weakStore.writeAwait;
  const lectures = (deps.lectures || (lecturesStore.read(userId) || []).filter(lecture => lecture?.blockId === blockId && !lecture.mergedInto));
  const objectives = deps.objectives || flattenObjectiveEntry((objectivesStore.read(userId) || {})[blockId]);
  const report = deps.report !== undefined ? deps.report : latestBlockReport(schoolResultsStore.read(userId), blockId);
  const callAIJSON = deps.callAIJSON || (await import("../../aiClient.js")).callAIJSON;
  const fetchContent = deps.fetchLectureContent || (await import("../../firebaseData.js")).fetchLectureContent;

  const current = readWeak(userId) || {};
  const entries = (current[blockId] || []).filter(entry => entry?.tags?.includes("exam-report"));
  if (!entries.length) return { blockId, mapped: 0, broad: 0 };
  const raw = await callAIJSON(
    "You map school exam report categories to lectures and search keywords. Return ONLY JSON.",
    buildReportTargetPrompt(entries.map(entry => entry.concept), lectures), { targets: [] }, 4000);
  const targets = normalizeReportTargets(raw, lectures);
  if (!targets.size) throw new Error("The AI returned no category mapping. Try again when the AI bridge is available.");
  const withText = [];
  for (const lecture of lectures) {
    const content = await fetchContent(userId, lecture.id).catch(() => null);
    withText.push({ ...lecture, chunks: content?.chunks || lecture.chunks || [], atoms: content?.atoms || lecture.atoms || [] });
  }
  let mapped = 0, broad = 0;
  const next = (current[blockId] || []).map(entry => {
    if (!entry?.tags?.includes("exam-report")) return entry;
    const ai = targets.get(norm(entry.concept));
    if (!ai) return entry;
    const match = matchCategoryTarget(ai, { lectures: withText, objectives });
    mapped++; if (ai.broad) broad++;
    return withReportTarget(entry, { broad: ai.broad, keywords: ai.keywords, ...match }, { lectures, now, report: entry.reportName ? null : report });
  });
  // Re-read so a concept recorded meanwhile in another block is kept.
  await writeWeak(userId, { ...(readWeak(userId) || {}), [blockId]: next });
  return { blockId, mapped, broad, total: entries.length };
}
