import * as partsStore from "../../../stores/objectiveParts.js";
import { buildObjectivePartsPrompt, normalizeObjectiveParts, inventoryIsCurrent, sourceMatches, answeredForParts } from "../../../engine/objectiveParts.js";
import { quizAnswerKey } from "../../../engine/questionHistory.js";

const SYSTEM = "You map medical-school learning objectives to the exact lecture content they cover. Return compact JSON only.";
const inFlight = new Map();

/**
 * The lecture's parts inventory, building the missing objectives once with one AI
 * call. Never throws: a failed build returns whatever is stored, and quizzes then
 * run without part targeting.
 */
export async function ensureObjectiveParts({ userId = null, lectureId, objectives = [], pages = [], history = [] } = {}, deps = {}) {
  const store = deps.partsStore || partsStore;
  if (!lectureId || !objectives.length || !pages.some((page) => String(page.text || "").trim().length > 200)) return store.read(userId, lectureId);
  const stored = store.read(userId, lectureId);
  if (inventoryIsCurrent(stored, { pages, objectives })) return stored;
  const sameSource = sourceMatches(stored, pages);
  const missing = sameSource ? objectives.filter((objective) => !stored.objectives?.[String(objective.id || objective.code)] && !stored.attempted?.includes(String(objective.id || objective.code))) : objectives;
  if (!missing.length || typeof deps.callAIJSON !== "function") return stored;
  const flightKey = `${userId}:${lectureId}:${missing.map((objective) => objective.id).sort().join(",")}`;
  if (inFlight.has(flightKey)) return inFlight.get(flightKey);
  const job = (async () => {
    try {
      const answered = answeredForParts(history, missing, quizAnswerKey);
      const raw = await deps.callAIJSON(SYSTEM, buildObjectivePartsPrompt({ objectives: missing, pages, answered }), { objectives: [], history: [] }, 6000, undefined, 0.2, { timeoutMs: deps.timeoutMs || 120000, signal: deps.signal, purpose: "objective-parts" });
      const built = normalizeObjectiveParts(raw, { lectureId, objectives: missing, pages, answered });
      return await store.save(userId, lectureId, built);
    } catch (error) {
      console.warn("objective parts: build failed", error?.message || error);
      return stored;
    } finally {
      inFlight.delete(flightKey);
    }
  })();
  inFlight.set(flightKey, job);
  return job;
}
