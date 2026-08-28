import { describe, it, expect, vi, afterEach } from "vitest";
import { probeIsFresh, bridgeComplete, resetBridgeProbe } from "./llmBridge.js";
import { installDomStorage } from "./stores/testEnv.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetBridgeProbe(); });

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
