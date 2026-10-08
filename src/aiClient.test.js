import { describe, it, expect, vi, beforeEach } from "vitest";
const { call, bridgeCall } = vi.hoisted(() => ({ call: vi.fn(), bridgeCall: vi.fn() }));
vi.mock("firebase/functions", () => ({ getFunctions: () => ({}), httpsCallable: () => call }));
vi.mock("./firebase.js", () => ({ app: {} }));
vi.mock("./llmBridge.js", () => ({ bridgeComplete: bridgeCall, parseBridgeJSON: JSON.parse }));
import { callAIJSON } from "./aiClient.js";
beforeEach(() => { call.mockReset(); bridgeCall.mockReset().mockResolvedValue(null); });
describe("AI JSON failure handling", () => {
  it("retains fallback behavior for existing callers", async () => {
    call.mockRejectedValue(new Error("service unavailable"));
    expect(await callAIJSON("s", "u", { atoms: [] })).toEqual({ atoms: [] });
  });
  it("surfaces failures for extraction callers", async () => {
    call.mockRejectedValue(new Error("usage limit reached"));
    await expect(callAIJSON("s", "u", {}, 4000, undefined, undefined, { throwOnError: true })).rejects.toThrow("usage limit reached");
  });
  it("rejects missing structured output in strict mode", async () => {
    call.mockResolvedValue({ data: {} });
    await expect(callAIJSON("s", "u", {}, 4000, undefined, undefined, { throwOnError: true })).rejects.toThrow("invalid JSON");
  });
});


it("passes the shared preparation deadline into the bridge instead of leaving a five-minute orphan", async () => {
  bridgeCall.mockResolvedValue('{"ok":true}');
  expect(await callAIJSON("s", "u", {}, 1000, undefined, undefined, { timeoutMs: 100, bridgeTimeoutMs: 500 })).toEqual({ ok: true });
  expect(bridgeCall.mock.calls[0][0].timeoutMs).toBe(100);
  expect(call).not.toHaveBeenCalled();
});

it("preserves strict provider errors for limit routing without calling paid API fallbacks", async () => {
  const error = new Error("bridge 502: codex usage limit reached");
  bridgeCall.mockRejectedValue(error);
  await expect(callAIJSON("s", "u", {}, 1000, undefined, undefined, { bridgeOnly: true, bridgeBackend: "codex", bridgeBackendOnly: true })).rejects.toBe(error);
  expect(call).not.toHaveBeenCalled();
});
