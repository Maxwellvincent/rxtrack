import { questionPreparationCapabilities } from "./llmBridge.js";

// Local inference stays serial. Overlap only when the bridge explicitly offers
// separate cloud-writing and subscription-review resources; no paid API fallback.
export async function questionPreparationDeps(callAIJSON) {
  const capability = await questionPreparationCapabilities();
  if (capability?.writer !== "ollama-cloud" || capability?.reviewer !== "codex") {
    return { callAIJSON, prepareConcurrency: 1 };
  }
  const routed = backend => (...params) => {
    params[6] = { ...(params[6] || {}), bridgeBackend: backend, bridgeBackendOnly: true, bridgeOnly: true };
    return callAIJSON(...params);
  };
  return {
    callAIJSON: routed(capability.writer), reviewAIJSON: routed(capability.reviewer),
    prepareConcurrency: 2, prepareBatchSize: 5, reviewBatchSize: 5,
  };
}
