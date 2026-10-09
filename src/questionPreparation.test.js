import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./llmBridge.js", () => ({ questionPreparationCapabilities: vi.fn() }));
import { questionPreparationCapabilities } from "./llmBridge.js";
import { questionPreparationDeps, resetQuestionProviderLimit, QUESTION_PREPARATION_BUDGET_MS } from "./questionPreparation.js";

beforeEach(() => { resetQuestionProviderLimit(); questionPreparationCapabilities.mockResolvedValue({ writer: "ollama-cloud", reviewer: "codex" }); });
afterEach(() => { vi.useRealTimers(); });
describe("question preparation routing", () => {
  it("fails promptly instead of silently using local Ollama when the route is unavailable", async () => {
    questionPreparationCapabilities.mockResolvedValue(null);
    const call = vi.fn();
    await expect(questionPreparationDeps(call)).rejects.toThrow("provider route is unavailable");
    expect(call).not.toHaveBeenCalled();
  });
  it("uses Codex for both independent calls while preserving strict routing", async () => {
    const call = vi.fn().mockResolvedValue({});
    const deps = await questionPreparationDeps(call);
    await deps.callAIJSON("system", "draft", {}, 8000, undefined, undefined, { timeoutMs: 1234 });
    await deps.reviewAIJSON("system", "review", {}, 8000, undefined, undefined, { timeoutMs: 987 });
    expect(call.mock.calls.every(args => args[6].bridgeBackend === "codex" && args[6].bridgeOnly && args[6].bridgeBackendOnly)).toBe(true);
    expect(deps.reviewBatchSize).toBe(5);
    expect(deps.maxPreparationMs).toBe(QUESTION_PREPARATION_BUDGET_MS);
    expect(QUESTION_PREPARATION_BUDGET_MS).toBe(180000);
  });
  it("switches drafts and subsequent reviews after a real usage limit", async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error("You've hit your usage limit. Try again in 2 hours")).mockResolvedValue({ ready: true });
    const deps = await questionPreparationDeps(call);
    await deps.callAIJSON("system", "draft");
    await deps.reviewAIJSON("system", "review");
    expect(call.mock.calls.map(args => args[6].bridgeBackend)).toEqual(["codex", "ollama-cloud", "ollama-cloud"]);
    expect(call.mock.calls.slice(1).every(args => args[6].bridgeModelTier === "routine")).toBe(true);
  });
  it("does not disguise timeouts, outages or malformed JSON as a usage limit", async () => {
    for (const message of ["network failure", "timeout", "invalid JSON", "source review failed"]) {
      const call = vi.fn().mockRejectedValue(new Error(message));
      const deps = await questionPreparationDeps(call);
      await expect(deps.callAIJSON("system", "draft")).rejects.toThrow(message);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });
  it("preserves the original deadline when switching providers and rechecks Codex later", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const call = vi.fn().mockImplementationOnce(async () => { vi.setSystemTime(1400); throw new Error("Rate limit reached; retry in 2 seconds"); }).mockResolvedValue({});
    const deps = await questionPreparationDeps(call);
    await deps.callAIJSON("system", "draft", {}, 1000, undefined, undefined, { timeoutMs: 1000 });
    expect(call.mock.calls[1][6].timeoutMs).toBe(600);
    vi.setSystemTime(3500);
    await deps.callAIJSON("system", "next draft");
    expect(call.mock.calls[2][6].bridgeBackend).toBe("codex");
  });
});
