import { describe, it, expect, vi } from "vitest";
vi.mock("./llmBridge.js", () => ({ questionPreparationCapabilities: vi.fn() }));
import { questionPreparationCapabilities } from "./llmBridge.js";
import { questionPreparationDeps } from "./questionPreparation.js";

describe("question preparation routing", () => {
  it("keeps local generation serial when separate resources are unavailable", async () => {
    questionPreparationCapabilities.mockResolvedValue(null);
    const call = vi.fn();
    expect(await questionPreparationDeps(call)).toEqual({ callAIJSON: call, prepareConcurrency: 1 });
  });
  it("routes drafts and reviews separately without paid fallback or losing deadlines", async () => {
    questionPreparationCapabilities.mockResolvedValue({ writer: "ollama-cloud", reviewer: "codex" });
    const call = vi.fn().mockResolvedValue({});
    const deps = await questionPreparationDeps(call);
    await deps.callAIJSON("system", "draft", {}, 8000, undefined, undefined, { timeoutMs: 1234 });
    await deps.reviewAIJSON("system", "review", {}, 8000, undefined, undefined, { timeoutMs: 987 });
    expect(call.mock.calls[0][6]).toEqual({ timeoutMs: 1234, bridgeBackend: "ollama-cloud", bridgeBackendOnly: true, bridgeOnly: true });
    expect(call.mock.calls[1][6]).toEqual({ timeoutMs: 987, bridgeBackend: "codex", bridgeBackendOnly: true, bridgeOnly: true });
    expect(deps.prepareConcurrency).toBe(2);
    expect(deps.reviewBatchSize).toBe(5);
  });
});
