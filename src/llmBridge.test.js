import { describe, it, expect, vi, afterEach } from "vitest";
import { probeIsFresh, bridgeComplete, parseBridgeJSON, resetBridgeProbe, questionPreparationCapabilities } from "./llmBridge.js";
import { installDomStorage } from "./stores/testEnv.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetBridgeProbe(); });

it("reads configured preparation capabilities and refuses reviewer fallback", async () => {
  installDomStorage(); resetBridgeProbe();
  const capability = { writer: "ollama-cloud", reviewer: "codex" };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ questionPreparation: capability }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "unverified", backend: "ollama" }) });
  vi.stubGlobal("fetch", fetchMock);
  expect(await questionPreparationCapabilities()).toEqual(capability);
  await expect(bridgeComplete({ prompt: "review", backend: "codex", backendOnly: true })).rejects.toThrow("unexpected backend");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).backendOnly).toBe(true);
});

it("preserves a Codex usage limit and permits the immediate strict cloud fallback", async () => {
  installDomStorage(); resetBridgeProbe();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: { message: "codex: You have hit your usage limit. Try again in 2 hours." } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ text: '{"questions":[]}', backend: "ollama-cloud" }) });
  vi.stubGlobal("fetch", fetchMock);
  await expect(bridgeComplete({ prompt: "draft", backend: "codex", backendOnly: true })).rejects.toThrow("usage limit");
  expect(await bridgeComplete({ prompt: "draft", backend: "ollama-cloud", backendOnly: true })).toBe('{"questions":[]}');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("bounds a stalled completion and cools down before using the bridge again", async () => {
  installDomStorage(); vi.useFakeTimers(); resetBridgeProbe();
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true }).mockImplementationOnce((_url, options) =>
    new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))));
  vi.stubGlobal("fetch", fetchMock);
  const result = bridgeComplete({ prompt: "test", timeoutMs: 100 });
  await vi.advanceTimersByTimeAsync(101);
  expect(await result).toBeNull();
  expect(await bridgeComplete({ prompt: "next" })).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("forwards the requested output budget to the local bridge", async () => {
  installDomStorage(); resetBridgeProbe();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "ok", backend: "ollama" }) });
  vi.stubGlobal("fetch", fetchMock);
  await bridgeComplete({ prompt: "ten questions", maxTokens: 8000, timeoutMs: 2500 });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).maxTokens).toBe(8000);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).timeoutMs).toBe(2500);
});

const NOW = 1_000_000;

describe("probeIsFresh", () => {
  it("trusts a recent success", () => {
    expect(probeIsFresh({ at: NOW - 1_000, ok: true }, NOW)).toBe(true);
  });

  it("re-checks after a success goes stale", () => {
    expect(probeIsFresh({ at: NOW - 31_000, ok: true }, NOW)).toBe(false);
  });

  it("expires a failure quickly so one blip cannot blackball the bridge", () => {
    // The old policy cached this failure for 30s and sent a whole round to the cloud.
    expect(probeIsFresh({ at: NOW - 5_000, ok: false }, NOW)).toBe(false);
  });

  it("still avoids hammering a bridge that just failed", () => {
    expect(probeIsFresh({ at: NOW - 500, ok: false }, NOW)).toBe(true);
  });

  it("treats a missing probe as stale", () => {
    expect(probeIsFresh(undefined, NOW)).toBe(false);
    expect(probeIsFresh({ at: 0, ok: false }, NOW)).toBe(false);
  });

  it("forgets a failure sooner than a success", () => {
    const age = 10_000;
    expect(probeIsFresh({ at: NOW - age, ok: true }, NOW)).toBe(true);
    expect(probeIsFresh({ at: NOW - age, ok: false }, NOW)).toBe(false);
  });
});

describe("parseBridgeJSON", () => {
  it("repairs a missing comma in a local-model array response", () => {
    const malformed = `{"questions":[{"stem":"First","correct":"A"} {"stem":"Second","correct":"B"}]}`;
    expect(parseBridgeJSON(malformed).questions).toHaveLength(2);
  });

  it("repairs fenced JSON with a trailing comma", () => {
    expect(parseBridgeJSON('```json\n{"questions":[],}\n```')).toEqual({ questions: [] });
  });
});
