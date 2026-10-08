import { questionPreparationCapabilities } from "./llmBridge.js";

const LIMIT_KEY = "rxt_codex_lecture_limit_until";
const RECHECK_MS = 15 * 60_000;
let limitedUntil = 0;

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
  try { localStorage.removeItem(LIMIT_KEY); } catch { /* optional storage */ }
}

// Codex writes and independently reviews by default. A genuine usage-limit
// response switches both requests to separate Ollama Cloud passes, otherwise
// a depleted Codex reviewer would prevent the fallback writer from being useful.
export async function questionPreparationDeps(callAIJSON) {
  const capability = await questionPreparationCapabilities();
  const cloudAvailable = capability?.writer === "ollama-cloud" || capability?.fallbackWriter === "ollama-cloud";
  if (!cloudAvailable || capability?.reviewer !== "codex") {
    return { callAIJSON, prepareConcurrency: 1 };
  }
  const routed = async (...params) => {
    const options = params[6] || {};
    const deadline = options.timeoutMs ? Date.now() + Number(options.timeoutMs) : null;
    const call = backend => {
      options.signal?.throwIfAborted();
      const remaining = deadline === null ? null : deadline - Date.now();
      if (remaining !== null && remaining <= 0) throw new Error("Question preparation deadline exceeded before provider fallback");
      const args = [...params];
      args[6] = { ...options, ...(remaining === null ? {} : { timeoutMs: remaining }), bridgeBackend: backend, bridgeBackendOnly: true, bridgeOnly: true };
      return callAIJSON(...args);
    };
    if (Date.now() < limitDeadline()) return call("ollama-cloud");
    try { return await call("codex"); }
    catch (error) {
      options.signal?.throwIfAborted();
      if (!isCodexUsageLimit(error)) throw error;
      recordLimit(error);
      return call("ollama-cloud");
    }
  };
  return {
    callAIJSON: routed, reviewAIJSON: routed,
    prepareConcurrency: 3, prepareBatchSize: 5, reviewBatchSize: 5,
    // Permit one reviewed refill wave after the parallel initial drafts.
    // This is a shared ceiling, not a fresh timeout for each request.
    maxPreparationMs: 360_000,
  };
}
