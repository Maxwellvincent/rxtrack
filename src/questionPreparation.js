import { createRequestGate } from "./requestConcurrency.js";
import { questionPreparationCapabilities } from "./llmBridge.js";
import { capacityKind } from "./providerCapacity.js";

export const QUESTION_PREPARATION_BUDGET_MS = 600_000;
export function questionPreparationBudget(count, allowLocalFallback = false) {
  const requested = Math.max(1, Math.floor(Number(count) || 1));
  const perQuestion = allowLocalFallback ? 180_000 : 45_000;
  const ceiling = allowLocalFallback ? 3_600_000 : 900_000;
  return Math.max(QUESTION_PREPARATION_BUDGET_MS, Math.min(ceiling, requested * perQuestion));
}
export const QUESTION_PREPARATION_POLICY = Object.freeze({
  prepareConcurrency: 3,
  prepareBatchSize: 5,
  reviewBatchSize: 5,
  starterBatchSize: 1,
  parallelIndependentReview: true,
  releaseVerifiedFirst: true,
  prepareSpareCandidates: 2,
  continueAfterEmptyRounds: true,
  maxEmptyRounds: 3,
  focusedRefill: true,
});
export const LOCAL_QUESTION_PREPARATION_POLICY = Object.freeze({
  prepareConcurrency: 1,
  prepareBatchSize: 1,
  reviewBatchSize: 1,
  parallelIndependentReview: false,
});

const LIMIT_KEY = "rxt_codex_lecture_limit_until";
const RECHECK_MS = 15 * 60_000;
let limitedUntil = 0;
const cloudLimitErrors = new Map();
const preparationRequestGate=createRequestGate(()=>Date.now()<limitDeadline()?1:3);
const localRequestGate=createRequestGate(1);

export function isCodexUsageLimit(error) {
  return /(?:hit|reached|exceeded|exhausted).{0,40}(?:usage|rate|quota|limit)|(?:usage|rate)[ -]?limit|quota.{0,30}(?:exceeded|exhausted)|resource_exhausted/i.test(String(error?.message || error));
}

function limitDeadline() {
  try { return Math.max(limitedUntil, Number(localStorage.getItem(LIMIT_KEY)) || 0); }
  catch { return limitedUntil; }
}

function recordLimit(error) {
  const match = String(error?.message || error).match(/(?:retry|try again|reset)\s+(?:after|in)\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i);
  const unit = match?.[2]?.toLowerCase();
  const delay = match ? Number(match[1]) * (unit.startsWith("h") ? 3_600_000 : unit.startsWith("m") ? 60_000 : 1000) : RECHECK_MS;
  limitedUntil = Date.now() + Math.max(1000, delay);
  try { localStorage.setItem(LIMIT_KEY, String(limitedUntil)); } catch { /* memory fallback */ }
}

export function resetQuestionProviderLimit() {
  limitedUntil = 0;
  cloudLimitErrors.clear();
  try { localStorage.removeItem(LIMIT_KEY); } catch { /* optional storage */ }
}

// Codex writes and independently reviews by default. A genuine usage-limit
// response switches both requests together. Local Ollama remains available when
// both subscription and cloud capacity are exhausted; all reviews still run.
export async function questionPreparationDeps(callAIJSON) {
  const capability = await questionPreparationCapabilities();
  const cloudAvailable = capability?.writer === "ollama-cloud" || capability?.fallbackWriter === "ollama-cloud";
  const cloudTiers = [...new Set((capability?.cloudTiers || [{ tier: "routine" }])
    .map(entry => entry.tier).filter(tier => ["routine", "escalation", "quality"].includes(tier)))];
  const remoteFallbacks = [...new Set(capability?.fallbackWriters || [])]
    .filter(provider => ["openrouter", "openai"].includes(provider));
  const localAvailable = capability?.localWriter === "ollama" || capability?.writer === "ollama";
  const codexAvailable = capability?.writer === "codex" || capability?.reviewer === "codex";
  if ((!cloudAvailable && !localAvailable && !codexAvailable) || !["codex", "ollama-cloud", "ollama"].includes(capability?.reviewer)) {
    throw new Error("Lecture question provider route is unavailable. Check the bridge connection and available models, then reload RXTrack.");
  }
  const gate=preparationRequestGate;
  const routed = async (...params) => {
    const options = params[6] || {};
    const deadline = options.timeoutMs ? Date.now() + Number(options.timeoutMs) : null;
    const call = (backend, tier = "routine") => (backend === "ollama" ? localRequestGate : gate)(() => {
      options.signal?.throwIfAborted();
      const remaining = deadline === null ? null : deadline - Date.now();
      if (remaining !== null && remaining <= 0) throw new Error("Question preparation deadline exceeded before provider fallback");
      const args = [...params];
      args[6] = {
        ...options,
        ...(remaining === null ? {} : { timeoutMs: remaining }),
        bridgeBackend: backend,
        bridgeBackendOnly: true,
        bridgeOnly: true,
        bridgePurpose: "lecture-questions",
        ...(backend === "ollama-cloud" ? { bridgeModelTier: tier } : {}),
      };
      const model = backend === "ollama-cloud" ? capability?.cloudTiers?.find(entry => entry.tier === tier)?.model : capability?.localModel;
      options.onProviderEvent?.({ provider: backend, ...(backend !== "codex" && model ? { model } : {}) });
      return callAIJSON(...args);
    }, options.signal);
    const exhausted = error => {
      const failure=error instanceof Error ? error : new Error(String(error));
      failure.questionRouteExhausted=true;
      return failure;
    };
    const fallbackCall = async () => {
      let lastError = null;
      for (const tier of cloudAvailable ? cloudTiers : []) {
        const paused = cloudLimitErrors.get(tier);
        if (paused && Date.now() < paused.retryAt) { lastError = paused; continue; }
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const result = await call("ollama-cloud", tier);
            cloudLimitErrors.delete(tier);
            return result;
          }
          catch (error) {
            options.signal?.throwIfAborted();
            if (capacityKind(error)) {
              lastError = Object.assign(error instanceof Error ? error : new Error(String(error)), {
                retryAt: Number(error?.retryAt) || Date.now() + 60000,
              });
              cloudLimitErrors.set(tier, lastError);
              break;
            }
            lastError = error;
            if (attempt || !/empty reply|returned no text|not valid or repairable json|invalid json/i.test(String(error?.message || error))) break;
          }
        }
      }
      for (const provider of remoteFallbacks) {
        const paused = cloudLimitErrors.get(provider);
        if (paused && Date.now() < paused.retryAt) { lastError = paused; continue; }
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const result = await call(provider);
            cloudLimitErrors.delete(provider);
            return result;
          } catch (error) {
            options.signal?.throwIfAborted();
            lastError = error;
            if (capacityKind(error)) {
              lastError = Object.assign(error instanceof Error ? error : new Error(String(error)), {
                retryAt: Number(error?.retryAt) || Date.now() + 60000,
              });
              cloudLimitErrors.set(provider, lastError);
              break;
            }
            if (attempt || !/empty reply|returned no text|not valid or repairable json|invalid json/i.test(String(error?.message || error))) break;
          }
        }
      }
      if (localAvailable) return call("ollama").catch(error => { throw exhausted(error); });
      throw exhausted(lastError || [...cloudLimitErrors.values()].at(-1) || new Error("No fallback question model is available."));
    };
    if (!codexAvailable || Date.now() < limitDeadline()) return fallbackCall();
    try { return await call("codex"); }
    catch (error) {
      options.signal?.throwIfAborted();
      if (!isCodexUsageLimit(error)) throw error;
      recordLimit(error);
      try { return await fallbackCall(); }
      catch(cloudError){
        if (!/^Codex usage limit reached\./i.test(cloudError.message)) cloudError.message=`Codex usage limit reached. ${cloudError.message}`;
        throw cloudError;
      }
    }
  };
  return {
    ...QUESTION_PREPARATION_POLICY,
    callAIJSON: routed, reviewAIJSON: routed,
    localFallbackAvailable: localAvailable,
    isLocalPreparation: () => localAvailable && (!codexAvailable || Date.now() < limitDeadline()
      && cloudTiers.every(tier => cloudLimitErrors.has(tier))
      && remoteFallbacks.every(provider => cloudLimitErrors.has(provider))),
    ...(Date.now() < limitDeadline() || !codexAvailable ? LOCAL_QUESTION_PREPARATION_POLICY : {}),
    // Allow reviewed replacement waves to finish in the background. Smaller
    // batches reduce per-call output and release verified questions sooner.
    // This is a shared ceiling, not a fresh timeout for each request.
    maxPreparationMs: QUESTION_PREPARATION_BUDGET_MS,
  };
}

// Counts refer only to independently accepted items; active calls are not ready questions.
export function questionPreparationStatus(progress) {
  const calls = progress?.diagnostics?.calls || [];
  const running = calls.filter(call => call.status === "running");
  const drafts = running.filter(call => call.stage === "draft").length;
  const reviews = running.length - drafts;
  const stages = [drafts ? `Writing ${drafts} batch${drafts === 1 ? "" : "es"}` : "", reviews ? `Checking ${reviews} batch${reviews === 1 ? "" : "es"}` : ""].filter(Boolean);
  const activity = stages.join(" · ") || "Preparing remaining questions";
  if (running.some(call => call.provider === "ollama")) return `Local Ollama · ${activity}`;
  if (running.some(call => call.provider === "ollama-cloud" && /^kimi/i.test(call.model || ""))) return `Kimi · ${activity}`;
  return activity;
}
