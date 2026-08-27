import { describe, it, expect, vi, beforeEach } from "vitest";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("firebase/functions", () => ({ getFunctions: () => ({}), httpsCallable: () => call }));
vi.mock("./firebase.js", () => ({ app: {} }));
vi.mock("./llmBridge.js", () => ({ bridgeComplete: async () => null, parseBridgeJSON: JSON.parse }));
import { callAIJSON } from "./aiClient.js";
beforeEach(() => { call.mockReset(); });
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
